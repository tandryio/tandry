import { execFileSync } from "node:child_process";
import { readMarker, readRun } from "@tandryio/bridge/local";
import { activeSessions, registerMonitor, sessionIdFrom, unregisterMonitor } from "./files";

const POLL_MS = 500;
/** A wake this recent was meant for whoever is watching now, even if it was signalled just before we looked. */
const FRESH_MS = 2_000;

interface ProcessInfo { pid: number; ppid: number; comm: string }
function infoOf(pid: number): ProcessInfo | null {
  try {
    const line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 }).trim();
    const space = line.indexOf(" ");
    const ppid = Number(space > 0 ? line.slice(0, space) : line);
    return ppid ? { pid, ppid, comm: space > 0 ? line.slice(space + 1).trim() : "" } : null;
  } catch { return null; }
}

/**
 * The processes between this one and the grok that owns it, grok included.
 * Grok's monitor tool runs the command through a shell, so the chain is
 * usually shell then grok; it stops at the first grok, or after a few levels
 * when there is none (tests start the monitor themselves).
 */
function ancestors(): ProcessInfo[] {
  const chain: ProcessInfo[] = [];
  let pid = process.ppid;
  for (let level = 0; level < 5 && pid > 1; level++) {
    const info = infoOf(pid);
    if (!info) break;
    chain.push(info);
    if (/(^|\/)grok/.test(info.comm)) break;
    pid = info.ppid;
  }
  return chain;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * The session is named on the command line, which the join result spells out
 * for the model. Failing that, Grok's registry of open sessions maps the grok
 * process above us to its session.
 */
function findSession(argv: string[], chain: ProcessInfo[]): string | null {
  const flag = argv.indexOf("--session");
  const named = sessionIdFrom(flag >= 0 ? argv[flag + 1] : process.env.GROK_SESSION_ID);
  if (named) return named;
  const sessions = activeSessions();
  for (const { pid } of chain) {
    const session = sessions.find((entry) => entry.pid === pid);
    if (session) return sessionIdFrom(session.session_id);
  }
  return null;
}

/**
 * A dumb pipe: prints the bridge's notice when the bridge says the idle
 * conversation should be woken. No network.
 *
 * Grok stops its monitors when a session ends normally, but a grok killed by
 * a signal leaves them behind, and a monitor that is never woken would never
 * notice its stdout is gone. So it watches the processes above it: the shell
 * and the grok that started it, and the grok process Grok's registry names
 * for this session. When any of them is gone, so is the reason to stay.
 *
 * It also leaves with the conversation: once the room it was watching has
 * been left, there is nothing to wake for, and the next join's result asks
 * the model for a new monitor anyway.
 */
export function monitor(argv: string[]): void {
  const chain = ancestors();
  const sessionId = findSession(argv, chain);
  if (!sessionId) { console.error("usage: main monitor --session <grok session id>"); process.exit(2); }

  const stop = () => { unregisterMonitor(sessionId); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGHUP", stop);
  process.stdout.on("error", stop);

  const registered = activeSessions().find((entry) => entry.session_id === sessionId)?.pid;
  const watched = new Set(chain.map((info) => info.pid));
  if (registered && alive(registered)) watched.add(registered);

  const run = readRun(sessionId);
  const fresh = !!run && run.wake > 0 && Date.now() - run.wakeAt < FRESH_MS;
  let seen = (run?.wake ?? 0) - (fresh ? 1 : 0);
  // Registered only once the baseline is taken, so no wake can fall between the two.
  registerMonitor(sessionId);

  let joined = !!readMarker("grok", sessionId);
  setInterval(() => {
    // Orphaned: a process above us is gone, or we were reparented to init.
    if (process.ppid === 1 || [...watched].some((pid) => !alive(pid))) stop();
    // Left the room it was started for.
    const inRoom = !!readMarker("grok", sessionId);
    if (joined && !inRoom) stop();
    joined = inRoom;
    const current = readRun(sessionId);
    if (current && current.wake > seen) {
      seen = current.wake;
      if (current.wakeNotice) process.stdout.write(`${current.wakeNotice}\n`);
    }
  }, POLL_MS);
}
