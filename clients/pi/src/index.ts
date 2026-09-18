import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createBridge } from "@tandryio/bridge";
import { readWorkspace } from "@tandryio/bridge/local";
import { commands, commandBody } from "../../commands";

/** One extension instance per pi session; pi reloads it on new/resume/fork. */
export default function tandry(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  let starting = false;
  let waitingForOwner = false;
  const message = (content: string) => ({ customType: "tandry", content, display: true });
  const bridge = createBridge({
    host: "pi",
    shell: {
      // Print/JSON runs exit after their prompt instead of waiting for mail.
      wakeable: () => !!context?.model && (context.mode === "tui" || context.mode === "rpc") && !waitingForOwner,
      idle: () => !!context?.isIdle() && !starting,
      async wake(notice) {
        pi.sendMessage(message(notice), { triggerTurn: true, deliverAs: "followUp" });
      },
    },
  });

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    bridge.bind({ host: "pi", hostConversationId: ctx.sessionManager.getSessionId(), workspace: readWorkspace(ctx.cwd) });
  });
  pi.on("session_shutdown", () => {
    context = undefined;
    bridge.dispose();
  });
  pi.on("before_agent_start", (_event, ctx) => {
    context = ctx;
    // isIdle() is still true during prompt preflight in pi 0.85.1.
    starting = true;
    bridge.hostChanged();
    const notice = bridge.notice();
    if (notice) return { message: message(notice) };
  });
  pi.on("agent_start", (_event, ctx) => {
    context = ctx;
    starting = false;
    bridge.hostChanged();
  });
  pi.on("agent_settled", (_event, ctx) => {
    context = ctx;
    starting = false;
    bridge.hostChanged();
  });
  pi.on("model_select", (_event, ctx) => {
    context = ctx;
    bridge.hostChanged();
  });
  pi.on("ui_prompt_start", () => { waitingForOwner = true; bridge.hostChanged(); });
  pi.on("ui_prompt_end", () => { waitingForOwner = false; bridge.hostChanged(); });

  pi.on("tool_result", (event) => {
    const notice = bridge.notice();
    if (notice) return { content: [...event.content, { type: "text" as const, text: notice }] };
  });
  pi.on("turn_end", () => {
    const notice = bridge.notice();
    if (notice) pi.sendMessage(message(notice), { triggerTurn: true, deliverAs: "followUp" });
  });

  for (const tool of bridge.tools) {
    pi.registerTool({
      name: `tandry_${tool.name}`,
      label: `Tandry ${tool.name}`,
      description: tool.description,
      parameters: Type.Unsafe(tool.inputSchema),
      // Room mutations and inbox reads must finish before the next Tandry call.
      executionMode: "sequential",
      async execute(_id, params) {
        const result = await tool.call(params);
        if (result.isError) throw new Error(result.text);
        return { content: [{ type: "text", text: result.text }], details: {} };
      },
    });
  }
  for (const command of commands) {
    pi.registerCommand(`tandry-${command.name}`, {
      description: command.description,
      async handler(args) {
        pi.sendUserMessage(`${commandBody(command)}\n\nOwner request: ${args}`, { deliverAs: "followUp" });
      },
    });
  }
}
