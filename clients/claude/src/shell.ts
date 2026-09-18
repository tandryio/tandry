import type { Shell } from "@tandryio/bridge";
import { monitorAlive, readHost, type HostState } from "./files";

/**
 * Claude Code as a push host. The idle wake is the plugin monitor printing the
 * notice, which Claude Code turns into a turn; the bridge signals it through
 * the run file, so waking here only has to confirm the monitor is there to see
 * it. Whether a turn is running is what the hooks last recorded.
 */
export class ClaudeShell implements Shell {
  private host: HostState = { busy: false, injected: null };
  private monitor = false;

  constructor(private readonly claudePid: number) {}

  wakeable(): boolean {
    return this.monitor;
  }

  idle(): boolean {
    return !this.host.busy;
  }

  async wake(): Promise<void> {
    if (!monitorAlive(this.claudePid)) throw new Error("the Tandry monitor is not running in this Claude Code session");
  }

  /** Re-reads what the hooks and the monitor recorded. Returns the key a hook newly announced, and whether idle() or wakeable() changed. */
  refresh(sessionId: string): { announced: string | null; changed: boolean } {
    const host = readHost(sessionId);
    const monitor = monitorAlive(this.claudePid);
    const announced = host.injected && host.injected !== this.host.injected ? host.injected : null;
    const changed = host.busy !== this.host.busy || monitor !== this.monitor;
    this.host = host;
    this.monitor = monitor;
    return { announced, changed };
  }

  reset(): void {
    this.host = { busy: false, injected: null };
  }
}
