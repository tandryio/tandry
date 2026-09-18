import { execFileSync } from "node:child_process";
import { readRun } from "@tandryio/bridge/local";
import { readSession, registerMonitor, unregisterMonitor } from "./files";

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

/** A dumb pipe: prints the bridge's notice when the bridge says the idle conversation should be woken. No network. */
export function monitor(): void {
  let claudePid: number | null = null;
  let sessionId: string | null = null;
  let seen = 0;

  const stop = () => { if (claudePid) unregisterMonitor(claudePid); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGHUP", stop);
  process.stdout.on("error", stop);

  setInterval(() => {
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
      // Registered only once the baseline is taken, so no wake can fall between the two.
      registerMonitor(claudePid);
    }
    if (run && run.wake > seen) {
      seen = run.wake;
      if (run.wakeNotice) process.stdout.write(`${run.wakeNotice}\n`);
    }
  }, POLL_MS);
}
