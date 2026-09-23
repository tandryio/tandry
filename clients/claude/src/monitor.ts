import { execFileSync } from "node:child_process";
import { readRun } from "@tandryio/bridge/local";
import { processIdentity, readSession, writeMonitor } from "./files";

const POLL_MS = 500;
/** A wake this recent was meant for whoever is watching now, even if it was signalled just before we looked. */
const FRESH_MS = 2_000;

function parentOf(pid: number): number | null {
  try { return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 }).trim()) || null; } catch { return null; }
}

/**
 * Claude Code starts a monitor through a shell, so the claude process is one
 * level above our parent. Rather than trust that shape, take whichever
 * candidate the SessionStart hook has vouched for by writing its by-pid file.
 */
function findClaudePid(): number | null {
  const candidates = [Number(process.env.TANDRY_CLAUDE_PID), Number(process.env.CLAUDE_PID), process.ppid, parentOf(process.ppid)];
  return candidates.find((pid): pid is number => !!pid && !!readSession(pid)) ?? null;
}

/**
 * A dumb pipe: prints the bridge's notice when the bridge says the idle
 * conversation should be woken. No network.
 *
 * Claude Code arms it the first time the tandry:join skill is dispatched in a
 * session and keeps it for the session's lifetime; it is never re-armed, so it
 * stays through leave and a later join, silent while there is nothing to say.
 */
export function monitor(): void {
  let claudePid: number | null = null;
  let sessionId: string | null = null;
  let seen = 0;
  let host: string | null = null;

  // Signals end this process as they end any other; the record then stops being renewed, which is how it says so.
  process.stdout.on("error", () => process.exit(0));

  const tick = () => {
    if (!claudePid) {
      claudePid = findClaudePid();
      if (!claudePid) return;
    }
    const session = readSession(claudePid);
    if (!session) return;
    const run = readRun(session.sessionId);
    if (session.sessionId !== sessionId) {
      sessionId = session.sessionId;
      const fresh = !!run && run.wake > 0 && Date.now() - run.wakeAt < FRESH_MS;
      seen = (run?.wake ?? 0) - (fresh ? 1 : 0);
      // Recorded only once the baseline is taken, so no wake can fall between the two.
      host ??= processIdentity(claudePid);
    }
    // The lease, renewed every tick while this process lives. The identity may be empty (see processIdentity).
    if (host !== null) writeMonitor(claudePid, host);
    if (run && run.wake > seen) {
      seen = run.wake;
      if (run.wakeNotice) process.stdout.write(`${run.wakeNotice}\n`);
    }
  };
  // Registered at once: the join that armed this monitor is about to check for it.
  tick();
  setInterval(tick, POLL_MS);
}
