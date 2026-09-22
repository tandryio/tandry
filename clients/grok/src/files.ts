import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, remove, runPath, writeJson } from "@tandryio/bridge/local";

// Grok Build runs this plugin as two kinds of process: the MCP server, which
// Grok starts with GROK_SESSION_ID in its environment, and the monitor, which
// the model starts through Grok's monitor tool. Grok keeps a registry of its
// open sessions; the monitor falls back to it when started without an explicit
// session (measured on 1.0.40; see docs/redesign/03-hosts.md).

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const sessionIdFrom = (value: unknown): string | null => (typeof value === "string" && SESSION_ID.test(value) ? value : null);

/** One entry of Grok's own registry of open sessions, `~/.grok/active_sessions.json`. */
export interface ActiveSession {
  session_id: string;
  pid: number;
  cwd: string;
}
export function activeSessions(): ActiveSession[] {
  const home = process.env.GROK_HOME ?? path.join(os.homedir(), ".grok");
  const sessions = readJson<unknown>(path.join(home, "active_sessions.json"));
  return Array.isArray(sessions)
    ? sessions.filter((entry): entry is ActiveSession => !!entry && typeof entry === "object" && typeof (entry as ActiveSession).session_id === "string")
    : [];
}

/** The working directory Grok recorded for the session; the MCP server is not told it any other way. */
export function sessionCwd(sessionId: string): string | null {
  const cwd = activeSessions().find((entry) => entry.session_id === sessionId)?.cwd;
  return typeof cwd === "string" && fs.existsSync(cwd) ? cwd : null;
}

/** The monitor's registration. Waking is possible only while that process lives. */
const monitorPath = (sessionId: string) => `${runPath(sessionId)}.monitor`;
export const registerMonitor = (sessionId: string) => writeJson(monitorPath(sessionId), { pid: process.pid });
export function unregisterMonitor(sessionId: string): void {
  if (readJson<{ pid: number }>(monitorPath(sessionId))?.pid === process.pid) remove(monitorPath(sessionId));
}
export function monitorAlive(sessionId: string): boolean {
  const pid = readJson<{ pid: number }>(monitorPath(sessionId))?.pid;
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
