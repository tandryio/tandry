import { readMarker, readRun } from "@tandryio/bridge/local";
import { claudePidOf, readHost, removeMonitor, removeSession, sessionIdFrom, writeHost, writeSession } from "./files";

// The hook command. It runs on every tool call, so it is its own small bundle:
// files only, no network, no SDK.

type HookEvent = "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "Stop" | "SessionEnd";
const EVENTS: readonly string[] = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];

/** What Claude Code expects back, carrying the notice into the conversation at a turn boundary. */
function hookOutput(event: HookEvent, notice: string | null): Record<string, unknown> {
  if (!notice) return {};
  // A Stop hook can only continue the turn by blocking it with a reason.
  return event === "Stop" ? { decision: "block", reason: notice } : { hookSpecificOutput: { hookEventName: event, additionalContext: notice } };
}

function handle(event: HookEvent, input: Record<string, unknown>, claudePid: number): Record<string, unknown> {
  const sessionId = sessionIdFrom(input.session_id);
  if (!sessionId) return {};
  const joined = () => !!readMarker("claude", sessionId);

  if (event === "SessionStart") {
    writeSession(claudePid, { sessionId, cwd: typeof input.cwd === "string" ? input.cwd : process.cwd(), at: Date.now(), attended: process.env.CLAUDE_CODE_SESSION_ATTENDED !== "0" });
    // Compaction happens inside a turn; every other source starts between turns.
    if (input.source !== "compact" && joined()) writeHost(sessionId, { ...readHost(sessionId), busy: false });
    return {};
  }
  if (event === "SessionEnd") {
    removeSession(claudePid, sessionId);
    // /clear and an in-session /resume end the session and keep the process, and with it the monitor and its record.
    if (input.reason !== "clear" && input.reason !== "resume") removeMonitor(claudePid);
    if (joined()) writeHost(sessionId, { ...readHost(sessionId), busy: false });
    return {};
  }
  // A subagent's tool calls are not a boundary of this conversation.
  if (input.agent_id) return {};
  // Not in a room: nothing to announce and nobody to tell.
  if (!joined()) return {};

  const host = readHost(sessionId);
  const run = readRun(sessionId);
  const notice = run?.notice && run.key && run.key !== host.injected ? run.notice : null;
  // A Stop that carries a notice keeps the turn going.
  const busy = event !== "Stop" || !!notice;
  if (busy !== host.busy || notice) writeHost(sessionId, { busy, injected: notice ? run!.key : host.injected });
  return hookOutput(event, notice);
}

function main(): void {
  const event = process.argv[2] ?? "";
  if (!EVENTS.includes(event)) { console.error("usage: hook <event>"); process.exit(2); }
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    // A hook that fails must never get in the conversation's way.
    try { process.stdout.write(JSON.stringify(handle(event as HookEvent, JSON.parse(raw) as Record<string, unknown>, claudePidOf(process.ppid)))); } catch { /* say nothing */ }
  });
}

main();
