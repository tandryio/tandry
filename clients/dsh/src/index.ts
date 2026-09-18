import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-skill";
import { createBridge, type Bridge } from "@tandryio/bridge";
import { readWorkspace } from "@tandryio/bridge/local";
import { commands, commandBody } from "../../commands";

export const name = "tandry";
export const inject = ["agents", "tools"];

function message(text: string): UserMessage {
  return {
    id: crypto.randomUUID() as UserMessage["id"], role: "user",
    content: [{ type: "text", text }], source: { kind: "plugin", plugin: "tandry" },
  };
}

export function apply(ctx: Context, config: { wakeable?: boolean } = {}): void {
  const conversations = new Map<Agent, { bridge: Bridge; calls: Promise<unknown> }>();
  let disposed = false;

  function attach(agent: Agent) {
    // Runtime ownership distinguishes children from a fork resumed as a root.
    if (disposed || conversations.has(agent) || !ctx.agents.roots().includes(agent)) return;
    const bridge = createBridge({
      host: "dsh",
      shell: {
        idle: () => agent.status === "idle",
        wakeable: () => config.wakeable !== false && !disposed && ctx.agents.get(agent.id) === agent,
        async wake(notice) {
          if (disposed || ctx.agents.get(agent.id) !== agent) throw new Error("The dsh conversation is no longer active.");
          agent.followup(message(notice));
        },
      },
    });
    conversations.set(agent, { bridge, calls: Promise.resolve() });
    bridge.bind({ host: "dsh", hostConversationId: agent.id, workspace: readWorkspace(agent.session.header.cwd ?? process.cwd()) });
  }

  ctx.on("agent/session-start", ({ agent }) => attach(agent));
  ctx.on("agent/status", ({ agent }) => conversations.get(agent)?.bridge.hostChanged());
  ctx.on("agent/disposed", ({ agent }) => {
    conversations.get(agent)?.bridge.dispose();
    conversations.delete(agent);
  });
  ctx.effect(() => () => {
    disposed = true;
    for (const state of conversations.values()) state.bridge.dispose();
    conversations.clear();
  });
  // Plugin reload may see already active roots; historical sessions never enter
  // the live registry, so this does not reopen old conversations.
  for (const agent of ctx.agents.roots()) attach(agent);

  ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind !== "enter" || signal.aborted) return decision;
    const notice = conversations.get(agent)?.bridge.notice();
    return notice ? { ...decision, messages: [...decision.messages, message(notice)] } : decision;
  });
  ctx.on("tools/post-execute", async (exec, _result, next) => {
    const decision = await next();
    if (decision.kind !== "accept" || exec.signal.aborted || !exec.agent) return decision;
    const notice = conversations.get(exec.agent)?.bridge.notice();
    return notice ? { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), message(notice)] } : decision;
  });

  const definitions = createBridge({ host: "dsh", shell: { idle: () => false, wakeable: () => false, wake: async () => {} } });
  ctx.effect(() => () => definitions.dispose());
  for (const tool of definitions.tools) ctx.tools.register({
    name: `tandry_${tool.name}`,
    description: tool.description,
    // Zod attaches non-enumerable ~standard functions; dsh requires plain JSON.
    parameters: JSON.parse(JSON.stringify(tool.inputSchema)),
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] },
    async execute(params, exec) {
      const state = exec.agent && conversations.get(exec.agent);
      if (!state) throw new Error("Only active top-level dsh conversations can use Tandry.");
      const call = state.calls.then(() => {
        exec.signal.throwIfAborted();
        if (disposed || conversations.get(exec.agent!) !== state) throw new Error("The dsh conversation is no longer active.");
        return state.bridge.tools.find(candidate => candidate.name === tool.name)!.call(params);
      });
      state.calls = call.catch(() => {});
      const result = await call;
      if (result.isError) throw new Error(result.text);
      return result.text;
    },
  });
  ctx.inject(["skills"], ctx => {
    for (const command of commands) ctx.skills.register({
      name: `tandry-${command.name}`, description: command.description,
      content: commandBody(command), source: "bundled", provider: "tandry",
    });
  });
}
