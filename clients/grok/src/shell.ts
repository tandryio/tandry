import type { Shell } from "@tandryio/bridge";
import { monitorAlive } from "./files";

/**
 * Grok Build as a push host. The idle wake is the plugin monitor printing the
 * notice, which Grok turns into a turn; the bridge signals it through the run
 * file, so waking here only has to confirm the monitor is there to see it.
 *
 * Grok holds a monitor line that arrives during a turn until that turn ends,
 * then starts a new one with it (measured on 1.0.40). A wake therefore never
 * interrupts a turn, and this shell reports idle at all times: Grok runs no
 * plugin hooks that could say otherwise, and none are needed.
 */
export class GrokShell implements Shell {
  private monitor = false;

  constructor(private readonly sessionId: string | null) {}

  wakeable(): boolean {
    return this.monitor;
  }

  idle(): boolean {
    return true;
  }

  async wake(): Promise<void> {
    if (!this.sessionId || !monitorAlive(this.sessionId)) throw new Error("the Tandry inbox monitor is not running in this Grok Build session");
  }

  unwakeable(): string | null {
    if (this.monitor) return null;
    return this.sessionId
      ? "The Tandry inbox monitor is not running in this Grok Build session; every tool result says how to start it."
      : "Grok Build did not name this session, so no monitor can be started for it.";
  }

  /** Re-reads the monitor's registration. Returns whether wakeable() changed. */
  refresh(): boolean {
    const monitor = !!this.sessionId && monitorAlive(this.sessionId);
    const changed = monitor !== this.monitor;
    this.monitor = monitor;
    return changed;
  }
}
