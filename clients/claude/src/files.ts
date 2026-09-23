import { execFileSync } from "node:child_process";
import { byPidPath, readJson, remove, runPath, writeJson } from "@tandryio/bridge/local";

// Claude Code runs this plugin as three kinds of process: hooks, the MCP
// server and the monitor. Only hooks are told the session ID. The three share
// one thing, the claude process's pid: hooks and the MCP server are its
// children, the monitor its grandchild through a shell (measured on 2.1.274;
// see docs/redesign/03-hosts.md). Everything they tell each other is a small
// file, so no process here needs the network except the one holding the bridge.

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const sessionIdFrom = (value: unknown): string | null => (typeof value === "string" && SESSION_ID.test(value) ? value : null);

/** Tests run several conversations under one parent process. */
export const claudePidOf = (fallback: number): number => Number(process.env.TANDRY_CLAUDE_PID) || fallback;

/** Written by the SessionStart hook under the claude process's pid. It changes when /clear or /resume switches the session. */
export interface Session {
  sessionId: string;
  cwd: string;
  at: number;
  /**
   * Whether Claude Code arms plugin monitors in this session at all: it does
   * so from its interactive UI and never under `claude -p`. Read by the hook
   * from CLAUDE_CODE_SESSION_ATTENDED ("1" in an interactive session, "0" in
   * a one-shot run; measured on 2.1.278). Absent from records older versions
   * of this plugin wrote.
   */
  attended?: boolean;
}
export const readSession = (claudePid: number) => readJson<Session>(byPidPath(claudePid));
export const writeSession = (claudePid: number, session: Session) => writeJson(byPidPath(claudePid), session);
export function removeSession(claudePid: number, sessionId: string): void {
  if (readSession(claudePid)?.sessionId === sessionId) remove(byPidPath(claudePid));
}

/** What the hooks have seen of one session: whether a turn is running, and the unread state they last announced. */
export interface HostState {
  busy: boolean;
  injected: string | null;
}
const hostPath = (sessionId: string) => `${runPath(sessionId)}.host`;
export const readHost = (sessionId: string): HostState => readJson<HostState>(hostPath(sessionId)) ?? { busy: false, injected: null };
export const writeHost = (sessionId: string, state: HostState) => writeJson(hostPath(sessionId), state);

/**
 * A process beyond its pid, which the OS reuses: its start time as ps prints
 * it. Empty where ps knows no such process, which is what the tests' made-up
 * claude pids get; two empty identities compare equal, so those tests see
 * every record as their own.
 */
export function processIdentity(pid: number): string {
  try { return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 }).trim(); } catch { return ""; }
}

/**
 * The monitor's record. Claude Code arms one monitor per process, the first
 * time the tandry:join skill is dispatched, and never another; so the record
 * is the process's one arming, used up, and it stays for as long as that
 * claude process lives: the SessionEnd hook drops it when the process ends.
 * `host` names the claude process it was armed in by identity, not pid: a
 * record from a crashed claude whose pid came round again is not this
 * process's. Whether the monitor is running is a lease: it renews `seenAt`
 * on every tick while it lives, and a record whose lease has run out is an
 * exited monitor, however it went and whoever holds its pid now.
 */
export interface MonitorRecord {
  host: string;
  seenAt: number;
}
export const MONITOR_LEASE_MS = 2_000;
const monitorPath = (claudePid: number) => `${byPidPath(claudePid)}.monitor`;
export const readMonitor = (claudePid: number) => readJson<MonitorRecord>(monitorPath(claudePid));
export const writeMonitor = (claudePid: number, host: string) => writeJson(monitorPath(claudePid), { host, seenAt: Date.now() } satisfies MonitorRecord);
export const removeMonitor = (claudePid: number) => remove(monitorPath(claudePid));
export type MonitorState = "none" | "running" | "exited";
/** `identity` is the reader's claude process; a record from another process with that pid is none. */
export function monitorState(claudePid: number, identity: string, now = Date.now()): MonitorState {
  const record = readMonitor(claudePid);
  if (!record || record.host !== identity) return "none";
  return now - record.seenAt < MONITOR_LEASE_MS ? "running" : "exited";
}
