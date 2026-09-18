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

/** The monitor's registration. Waking is possible only while that process lives. */
const monitorPath = (claudePid: number) => `${byPidPath(claudePid)}.monitor`;
export const registerMonitor = (claudePid: number) => writeJson(monitorPath(claudePid), { pid: process.pid });
export function unregisterMonitor(claudePid: number): void {
  if (readJson<{ pid: number }>(monitorPath(claudePid))?.pid === process.pid) remove(monitorPath(claudePid));
}
export function monitorAlive(claudePid: number): boolean {
  const pid = readJson<{ pid: number }>(monitorPath(claudePid))?.pid;
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
