import { createBridge, type Bridge } from "@tandryio/bridge";
import { readWorkspace } from "@tandryio/bridge/local";
import { serveStdio } from "@tandryio/bridge/stdio";
import { claudePidOf, readSession, sessionIdFrom, type Session } from "./files";
import { ClaudeShell } from "./shell";

declare const TANDRY_VERSION: string | undefined;
const POLL_MS = 500;

/**
 * A by-pid file can outlive a crashed claude whose pid was reused. One written
 * after this process started is current; an older one is current if it names
 * the session Claude Code started this process for.
 */
function current(session: Session | null, startedAt: number): Session | null {
  if (!session || !sessionIdFrom(session.sessionId)) return null;
  const spawnedFor = process.env.CLAUDE_CODE_SESSION_ID;
  return !spawnedFor || session.sessionId === spawnedFor || session.at >= startedAt ? session : null;
}

export async function mcp(): Promise<void> {
  const claudePid = claudePidOf(process.ppid);
  const startedAt = Date.now();
  const shell = new ClaudeShell(claudePid);
  const make = () => createBridge({ host: "claude", shell, runFile: true });
  let bridge: Bridge = make();
  let sessionId: string | null = null;

  function poll(): void {
    const session = current(readSession(claudePid), startedAt);
    if (session && session.sessionId !== sessionId) {
      // /clear or /resume put another conversation in this process. A bridge belongs to one.
      if (sessionId) { bridge.dispose(); bridge = make(); shell.reset(); }
      sessionId = session.sessionId;
      bridge.bind({ host: "claude", hostConversationId: sessionId, workspace: readWorkspace(session.cwd) });
    }
    if (!sessionId) return;
    const { announced, changed } = shell.refresh(sessionId);
    // In this order: a state a hook already announced must not be woken for when the turn ends.
    if (announced) bridge.announced(announced);
    if (changed) bridge.hostChanged();
  }
  const timer = setInterval(poll, POLL_MS);
  timer.unref();
  poll();

  await serveStdio({
    version: typeof TANDRY_VERSION === "string" ? TANDRY_VERSION : "0.0.0-dev",
    bridge: {
      tools: bridge.tools.map((tool) => ({ ...tool, call: (params) => bridge.tools.find((entry) => entry.name === tool.name)!.call(params) })),
      dispose() { clearInterval(timer); bridge.dispose(); },
    },
    onCall: poll,
  });
}
