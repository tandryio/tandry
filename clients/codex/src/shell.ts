import { execFile } from "node:child_process";
import type { Shell } from "@tandryio/bridge";

export type HookEvent = "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "Stop";

/**
 * Codex as a push host. Idle wake is `codex queue --thread`, which queues a
 * turn rather than interrupting one. Whether a turn is running is learned from
 * the lifecycle hooks Codex hands to this same process as `codex_event` calls.
 */
export class CodexShell implements Shell {
  threadId: string | null = null;
  private busy = false;
  private queueBroken = false;
  private stopObserved = false;

  /** A Stop hook must establish that we can observe the end of a queued turn. */
  wakeable(): boolean {
    return !!this.threadId && this.stopObserved && !this.queueBroken;
  }

  hooksReady(): boolean { return this.stopObserved; }

  idle(): boolean {
    return !this.busy;
  }

  /** `injected` is true when this event's hook output carried a notice, which keeps the turn going. */
  observe(event: HookEvent, injected: boolean): void {
    if (event === "Stop") this.stopObserved = true;
    this.busy = event === "UserPromptSubmit" || event === "PostToolUse" || (event === "Stop" && injected);
  }

  wake(notice: string): Promise<void> {
    const threadId = this.threadId;
    if (!threadId) return Promise.reject(new Error("Codex has not said which thread this is"));
    return new Promise((resolve, reject) => {
      execFile(process.env.TANDRY_CODEX_BIN ?? "codex", ["queue", "--thread", threadId, "--message", notice], { timeout: 15_000, maxBuffer: 64 * 1024 }, (error) => {
        if (!error) { this.busy = true; resolve(); return; }
        // A Codex without `queue`, or not on PATH: say so to senders instead of failing every time.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") this.queueBroken = true;
        reject(new Error(`codex queue failed: ${error.message.split("\n")[0]}`));
      });
    });
  }
}

/** What Codex expects back from a hook, carrying the notice into the conversation at a turn boundary. */
export function hookOutput(event: HookEvent, notice: string | null): Record<string, unknown> {
  if (!notice) return {};
  // A Stop hook can only continue the turn by blocking it with a reason.
  return event === "Stop" ? { decision: "block", reason: notice } : { hookSpecificOutput: { hookEventName: event, additionalContext: notice } };
}

/** Codex names the calling thread in MCP request metadata, and nowhere else. It is never taken from tool arguments. */
export function threadIdFrom(meta: Record<string, unknown>): string | null {
  const id = meta.threadId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}
