import { createBridge, type Tool } from "@tandryio/bridge";
import { readWorkspace } from "@tandryio/bridge/local";
import { serveStdio } from "@tandryio/bridge/stdio";
import { CodexShell, hookOutput, threadIdFrom, type HookEvent } from "./shell";

declare const TANDRY_VERSION: string | undefined;
const EVENTS: readonly HookEvent[] = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"];

async function mcp(): Promise<void> {
  const shell = new CodexShell();
  const bridge = createBridge({ host: "codex", shell });
  // The MCP process starts in the plugin directory; hooks report the project's.
  let cwd: string | null = null;

  // Hooks of type mcp_tool land here, in the process that holds the bridge, so they cost no network round trip.
  const codexEvent: Tool = {
    name: "codex_event",
    description: "Internal: Codex lifecycle hooks call this. Not for the model.",
    inputSchema: { type: "object", properties: { event: { type: "string", enum: EVENTS }, cwd: { type: "string" } }, required: ["event"] },
    async call(params) {
      const event = (params as { event?: HookEvent }).event;
      if (!event || !EVENTS.includes(event)) return { text: "{}", isError: false };
      const notice = event === "SessionStart" ? null : bridge.notice();
      shell.observe(event, !!notice);
      bridge.hostChanged();
      return { text: JSON.stringify(hookOutput(event, notice)), isError: false };
    },
  };

  const tools = bridge.tools.map((tool): Tool => {
    if (tool.name !== "status" && tool.name !== "join") return tool;
    return {
      ...tool,
      async call(params) {
        const result = await tool.call(params);
        if (!result.isError && shell.threadId && !shell.hooksReady()) {
          result.text += "\nAutomatic wake is waiting for Codex's Stop hook. If it remains unavailable after this turn, ask the owner to enable and trust all four Tandry hooks in /hooks, then submit a prompt. Messages remain available through inbox.";
        }
        return result;
      },
    };
  });

  await serveStdio({
    bridge: { tools, dispose: bridge.dispose },
    version: typeof TANDRY_VERSION === "string" ? TANDRY_VERSION : "0.0.0-dev",
    extraTools: [codexEvent],
    onCall({ arguments: args, meta }) {
      if (typeof args.cwd === "string" && args.cwd.startsWith("/")) cwd ??= args.cwd;
      const threadId = threadIdFrom(meta);
      if (!threadId || shell.threadId === threadId) return;
      // Resuming without typing anything produces no request that names the
      // thread, so until the first turn this conversation shows as dormant.
      shell.threadId = threadId;
      bridge.bind({ host: "codex", hostConversationId: threadId, workspace: readWorkspace(cwd ?? process.cwd()) });
    },
  });
}

const command = process.argv[2];
if (command === "mcp") void mcp();
else { console.error("usage: tandry mcp"); process.exit(2); }
