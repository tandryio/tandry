import type { Plugin, Hooks } from "@opencode-ai/plugin";
import type { Session, SessionPromptAsyncData } from "@opencode-ai/sdk";
import { z } from "zod";
import { createBridge, type Bridge } from "@tandryio/bridge";
import { readWorkspace } from "@tandryio/bridge/local";
import { commands, commandBody } from "../../commands";

// The injected v1 client preserves OpenCode's in-process transport. Its Session
// types predate these persisted settings, which OpenCode 1.18.30 returns.
type HostSession = Session & {
  agent?: string;
  model?: { providerID: string; id: string; variant?: string };
  time: Session["time"] & { archived?: number };
};
type Selection = { agent: string; model: { providerID: string; modelID: string; variant?: string }; variant?: string };
interface Conversation {
  bridge: Bridge;
  busy: boolean;
  calls: Promise<unknown>;
  selection?: Selection;
}

const tandry: Plugin = async ({ client, directory }) => {
  const conversations = new Map<string, Conversation>();
  const loading = new Map<string, Promise<Conversation | null>>();
  let disposed = false;
  // An unbound bridge supplies the shared definitions without reading credentials
  // or opening a link. Actual tool calls always use their host-provided session ID.
  const definitions = createBridge({ host: "opencode", shell: { idle: () => false, wakeable: () => false, wake: async () => {} } });

  function select(state: Conversation, info: HostSession) {
    if (info.agent && info.model) state.selection = {
      agent: info.agent,
      model: { providerID: info.model.providerID, modelID: info.model.id, variant: info.model.variant },
      variant: info.model.variant,
    };
  }

  async function conversation(id: string): Promise<Conversation | null> {
    if (disposed) return null;
    const existing = conversations.get(id);
    if (existing) return existing;
    const pending = loading.get(id);
    if (pending) return pending;
    const load = Promise.resolve().then(async () => {
      const { data: info } = await client.session.get({ path: { id }, throwOnError: true });
      if (disposed || loading.get(id) !== load || info.parentID || (info as HostSession).time.archived) return null;
      const state: Conversation = {
        busy: true,
        calls: Promise.resolve(),
        bridge: createBridge({
          host: "opencode",
          shell: {
            idle: () => !state.busy,
            wakeable: () => !disposed && !!state.selection,
            async wake(notice) {
              const { data: current } = await client.session.get({ path: { id }, throwOnError: true });
              select(state, current);
              const { data: statuses } = await client.session.status({ throwOnError: true });
              // The host omits idle sessions from this map. Check again after IO;
              // chat.message may have started an owner turn during the request.
              if (disposed || conversations.get(id) !== state || (current as HostSession).time.archived || state.busy || (statuses[id] && statuses[id].type !== "idle")) throw new Error("OpenCode is no longer idle.");
              const selection = state.selection;
              if (!selection) throw new Error("OpenCode has not supplied this conversation's agent and model.");
              state.busy = true;
              state.bridge.hostChanged();
              const body: NonNullable<SessionPromptAsyncData["body"]> & { variant?: string } = {
                ...selection, parts: [{ type: "text", text: notice, synthetic: true }],
              };
              try {
                await client.session.promptAsync({ path: { id }, body, throwOnError: true });
              } catch (error) {
                state.busy = false;
                state.bridge.hostChanged();
                throw error;
              }
            },
          },
        }),
      };
      select(state, info);
      conversations.set(id, state);
      state.bridge.bind({ host: "opencode", hostConversationId: id, workspace: readWorkspace(info.directory || directory) });
      return state;
    });
    loading.set(id, load);
    try { return await load; } finally { loading.delete(id); }
  }

  function remove(id: string) {
    loading.delete(id);
    conversations.get(id)?.bridge.dispose();
    conversations.delete(id);
  }

  const hooks: Hooks = {
    async dispose() {
      disposed = true;
      definitions.dispose();
      for (const id of conversations.keys()) remove(id);
    },
    async config(config) {
      config.command ??= {};
      for (const command of commands) config.command[`tandry-${command.name}`] ??= {
        description: command.description,
        template: `${commandBody(command)}\n\nOwner request: $ARGUMENTS`,
      };
    },
    async "chat.message"(input, output) {
      // This hook runs before persistence and before the host reports busy.
      const existing = conversations.get(input.sessionID);
      if (existing) { existing.busy = true; existing.bridge.hostChanged(); }
      const state = await conversation(input.sessionID);
      if (!state) return;
      state.busy = true;
      const model: Selection["model"] = output.message.model;
      state.selection = { agent: output.message.agent, model, variant: model.variant ?? input.variant };
      state.bridge.hostChanged();
      const notice = state.bridge.notice();
      if (notice && !output.parts.some(part => part.type === "text" && part.synthetic && part.text === notice)) output.parts.push({
        id: `prt_${crypto.randomUUID().replaceAll("-", "")}`, sessionID: input.sessionID,
        messageID: output.message.id, type: "text", text: notice, synthetic: true,
      });
    },
    async "tool.execute.after"(input, output) {
      const notice = conversations.get(input.sessionID)?.bridge.notice();
      if (notice) output.output += `\n\n${notice}`;
    },
    async event({ event }) {
      // Do not create bridges from session lists or arbitrary events: they also
      // describe historical and child sessions, not a conversation's activation.
      if (event.type === "session.status") {
        const state = conversations.get(event.properties.sessionID);
        if (state) { state.busy = event.properties.status.type !== "idle"; state.bridge.hostChanged(); }
      } else if (event.type === "session.deleted") {
        remove(event.properties.info.id);
      } else if (event.type === "session.updated") {
        const info: HostSession = event.properties.info;
        if (info.time.archived) remove(info.id);
        else {
          const state = conversations.get(info.id);
          if (state) { select(state, info); state.bridge.hostChanged(); }
        }
      }
    },
    tool: Object.fromEntries(definitions.tools.map(tool => [`tandry_${tool.name}`, {
      description: tool.description,
      args: (z.fromJSONSchema(tool.inputSchema) as z.ZodObject).shape,
      async execute(params: unknown, context: { sessionID: string }) {
        const state = await conversation(context.sessionID);
        if (!state) throw new Error("Only top-level OpenCode conversations can use Tandry.");
        // OpenCode can execute several native tools concurrently. Keep room
        // mutations ordered within this conversation, without blocking others.
        const call = state.calls.then(() => state.bridge.tools.find(candidate => candidate.name === tool.name)!.call(params));
        state.calls = call.catch(() => {});
        const result = await call;
        if (result.isError) throw new Error(result.text);
        return result.text;
      },
    }])),
  };
  return hooks;
};

export default tandry;
