import { createBridge } from "@tandryio/bridge";
import { readMarker, readWorkspace } from "@tandryio/bridge/local";
import { serveStdio } from "@tandryio/bridge/stdio";
import { monitorAlive, sessionCwd, sessionIdFrom } from "./files";
import { GrokShell } from "./shell";

declare const TANDRY_VERSION: string | undefined;
const POLL_MS = 500;

/** Single quotes for sh, which is what Grok's monitor tool runs its command with. */
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/**
 * Grok kills monitors when a session ends and starts none on resume, so the
 * model has to start ours. Every tool result of a joined conversation says so
 * while the monitor is missing; a running monitor makes this text disappear.
 */
export function monitorHint(sessionId: string, bundle: string): string {
  return [
    "Automatic delivery is off: the Tandry inbox monitor is not running in this Grok Build session.",
    `Start it now with the monitor tool: command \`node ${quote(bundle)} monitor --session ${quote(sessionId)}\`, description "Tandry inbox", persistent true.`,
    "It prints one line when a room message is waiting and nothing else; when that line arrives, call inbox.",
  ].join(" ");
}

export async function mcp(): Promise<void> {
  // Grok names the session in the environment of the MCP server it starts for it, and starts a new server on resume.
  const sessionId = sessionIdFrom(process.env.GROK_SESSION_ID);
  const shell = new GrokShell(sessionId);
  const bridge = createBridge({
    host: "grok", shell, runFile: true,
    conversation: sessionId ? { host: "grok", hostConversationId: sessionId, workspace: readWorkspace(sessionCwd(sessionId) ?? process.cwd()) } : undefined,
  });
  const bundle = process.argv[1] ?? "main.cjs";

  function poll(): void {
    // A grok killed by a signal can leave our stdin open through a child that
    // inherited it; being reparented to init is the sure sign it is gone.
    if (process.ppid === 1) { bridge.dispose(); process.exit(0); }
    if (shell.refresh()) bridge.hostChanged();
  }
  const timer = setInterval(poll, POLL_MS);
  timer.unref();
  poll();

  const needsMonitor = () => !!sessionId && !!readMarker("grok", sessionId) && !monitorAlive(sessionId);
  const tools = bridge.tools.map((tool) => ({
    ...tool,
    async call(params: unknown) {
      const result = await tool.call(params);
      return !result.isError && needsMonitor() ? { ...result, text: `${result.text}\n\n${monitorHint(sessionId!, bundle)}` } : result;
    },
  }));

  await serveStdio({
    version: typeof TANDRY_VERSION === "string" ? TANDRY_VERSION : "0.0.0-dev",
    bridge: { tools, dispose() { clearInterval(timer); bridge.dispose(); } },
    onCall: poll,
  });
}
