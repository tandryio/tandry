import { renderNotice } from "@tandryio/protocol";
import type { Shell } from "./index";
import type { UnreadState } from "./unread";

export type WakeState = "quiet" | "waking" | "pending" | "failed" | "stopped";

/**
 * The wake contract, once, for every host. A shell only says whether it can
 * wake and whether the host is idle, and performs the wake; when to wake is
 * decided here.
 *
 * 1. At most one unconsumed notice per conversation; later ones merge into it.
 * 2. One notice per unread state. Another needs new mail or a partial read, so
 *    an agent that ignores a notice is not woken again and one that stopped
 *    half-way is.
 * 3. A failing wake is retried a bounded number of times; the error shows in status.
 * 4. A running turn is never interrupted; idleness is rechecked before each attempt.
 * 5. Only the fixed notice enters the conversation. Bodies arrive through inbox.
 * 6. Reading the inbox voids a pending notice.
 */
export class Waker {
  state: WakeState = "quiet";
  lastError: string | null = null;
  private notifiedKey: string | null = null;
  /** Bumped whenever an in-flight wake must not take effect any more. */
  private generation = 0;

  /** `changed` runs whenever the answer of `peek()` may have changed. */
  constructor(private readonly unread: UnreadState, private readonly shell: Shell, private readonly retryDelaysMs: readonly number[], private readonly changed: () => void = () => {}) {}

  private announce(key: string | null): void {
    this.notifiedKey = key;
    this.changed();
  }

  /** Called whenever unread state or the host's idleness may have changed. */
  evaluate(): void {
    if (this.state === "stopped" || this.state === "waking" || this.state === "pending") return;
    const key = this.unread.key();
    if (!key || key === this.notifiedKey) return;
    if (!this.shell.wakeable() || !this.shell.idle()) return; // a boundary hook will carry the notice
    void this.wake(key);
  }

  private async wake(key: string): Promise<void> {
    this.state = "waking";
    const generation = ++this.generation;
    const current = () => this.state === "waking" && generation === this.generation;
    let error: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, this.retryDelaysMs[attempt - 1]));
      if (!current()) return;
      const unread = this.unread.current();
      // The agent read it, or a turn started, while we were backing off.
      if (!unread || !this.shell.idle()) { this.state = "quiet"; return; }
      try {
        await this.shell.wake(renderNotice(unread));
        if (!current()) return;
        this.announce(this.unread.key() ?? key);
        this.lastError = null;
        this.state = "pending";
        return;
      } catch (caught) { error = caught; }
    }
    if (!current()) return;
    // Still unread; boundary hooks keep notifying. Do not hammer a broken wake path for the same state.
    this.announce(key);
    this.lastError = error instanceof Error ? error.message : String(error);
    this.state = "failed";
  }

  /** The notice a boundary hook should inject now, or null, without marking it announced. */
  peek(): string | null {
    const unread = this.unread.current();
    const key = this.unread.key();
    return !unread || !key || key === this.notifiedKey || this.state === "stopped" ? null : renderNotice(unread);
  }

  /** The notice a boundary hook should inject now, or null. Shares rule 2 with wake. */
  notice(): string | null {
    const notice = this.peek();
    if (notice) this.announce(this.unread.key());
    return notice;
  }

  /** A hook in another process injected the notice for `key`. Stale keys are ignored: newer mail still needs its own notice. */
  announced(key: string): void {
    if (this.state !== "stopped" && key === this.unread.key() && key !== this.notifiedKey) this.announce(key);
  }

  /** An inbox read completed: whatever notice was pending is void. */
  inboxRead(): void {
    if (this.state === "stopped") return;
    this.generation++;
    this.state = "quiet";
    this.evaluate();
  }

  stop(): void {
    this.generation++;
    this.state = "stopped";
  }

  /** A fresh link, e.g. after a new join: notices may flow again. */
  restart(): void {
    this.generation++;
    this.state = "quiet";
    this.lastError = null;
    this.announce(null);
  }
}
