import type { Shell } from "@tandryio/bridge";
import { monitorState, processIdentity, readHost, type HostState, type MonitorState } from "./files";

/**
 * Claude Code as a push host. The idle wake is the plugin monitor printing the
 * notice, which Claude Code turns into a turn; the bridge signals it through
 * the run file, so waking here only has to confirm the monitor is there to see
 * it. Whether a turn is running is what the hooks last recorded.
 *
 * Claude Code arms the monitor once per process, the first time the
 * tandry:join skill is dispatched, and only from its interactive UI. What
 * decides whether such a dispatch would bring it now is read from files, so
 * it survives this MCP process being restarted: the monitor's record says
 * whether the process's one arming was used and whether its lease is live,
 * the session file whether the session is interactive. Both are read once
 * per poll; a wake decided on that reading is at most a poll stale.
 */
export class ClaudeShell implements Shell {
  private host: HostState = { busy: false, injected: null };
  private monitor: MonitorState = "none";
  private attended = true;
  /** The claude process this MCP server belongs to, for telling its monitor record from an earlier process's. */
  private readonly identity: string;

  constructor(private readonly claudePid: number) {
    this.identity = processIdentity(claudePid);
  }

  wakeable(): boolean {
    return this.monitor === "running";
  }

  idle(): boolean {
    return !this.host.busy;
  }

  async wake(): Promise<void> {
    if (!this.wakeable()) throw new Error("the Tandry monitor is not running in this Claude Code session");
  }

  /** Whether dispatching the tandry:join skill would arm the monitor now. */
  armable(): boolean {
    return this.monitor === "none" && this.attended;
  }

  unwakeable(): string | null {
    if (this.monitor === "running") return null;
    if (this.monitor === "exited") return "The Tandry inbox monitor exited, and Claude Code arms one monitor per session; this conversation is not woken while idle, and its hooks announce mail at its next turn.";
    if (!this.attended) return "Claude Code arms plugin monitors only in interactive sessions, and this is a one-shot run; this conversation is not woken while idle, and its hooks announce mail at tool boundaries.";
    return "The Tandry inbox monitor is not running; Claude Code arms it when the tandry:join skill is dispatched.";
  }

  /** Re-reads what the hooks and the monitor recorded. Returns the key a hook newly announced, and whether idle() or wakeable() changed. */
  refresh(sessionId: string, attended?: boolean): { announced: string | null; changed: boolean } {
    const host = readHost(sessionId);
    const monitor = monitorState(this.claudePid, this.identity);
    const announced = host.injected && host.injected !== this.host.injected ? host.injected : null;
    const changed = host.busy !== this.host.busy || (monitor === "running") !== (this.monitor === "running");
    this.host = host;
    this.monitor = monitor;
    if (attended !== undefined) this.attended = attended;
    return { announced, changed };
  }

  /** Another conversation in the same process: the hooks' record starts over, the monitor is the process's and stays. */
  reset(): void {
    this.host = { busy: false, injected: null };
  }
}
