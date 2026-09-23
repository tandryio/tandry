import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  PROTOCOL_VERSION, RoomId, TandryError, connectorToolNames, newId, newNonce, operations,
  renderConversationHandle, renderError, renderHistory, renderInbox, renderJoin, renderLeft,
  renderMembers, renderNewRoom, renderRenamed, renderRoomUpdated, renderSent, renderStatus, toolParameters, tools,
  type ConnectorOutput, type ConnectorToolName, type ConversationKey, type Input, type OperationName, type Output, type ToolParams,
} from "@tandryio/protocol";
import { z } from "zod";
import { connectorPrincipal } from "../auth/connector";
import type { Principal } from "../auth/principal";
import { execute, type HubContext } from "../operations/execute";

/**
 * The web connector: the protocol's tools as a remote MCP server. OAuth and
 * protocol state are request-scoped; the room owns all conversation state.
 */
export async function mcpBinding(request: Request, hub: HubContext): Promise<Response> {
  const who = await connectorPrincipal(hub.env, request);
  if (who instanceof Response) return who;
  return createMcpHandler(() => connectorServer(hub, who), { legacy: "stateless" }).fetch(request);
}

/** What a tool returns: the data (structuredContent) and the words the model reads (content). */
interface Reply<K extends ConnectorToolName> {
  result: ConnectorOutput<K>;
  text: string;
}

type Implementation<K extends ConnectorToolName> = (params: ToolParams<K>, handle: unknown) => Promise<Reply<K>>;

function connectorServer(hub: HubContext, who: Principal): McpServer {
  async function call<K extends OperationName>(op: K, input: Input<K>, context: { room?: string; conversation?: ConversationKey } = {}): Promise<Output<K>> {
    const result = await execute(hub, { op, input, principal: who, protocol: PROTOCOL_VERSION, ...context });
    if (!result.ok) throw new TandryError(result.error.code, result.error.message, result.error.data);
    return operations[op].output.parse(result.result) as Output<K>;
  }

  const implementations: { [K in ConnectorToolName]: Implementation<K> } = {
    async status() {
      const result = await call("status", {});
      return { result, text: renderStatus({ ...result, current: null, inactive: null }) };
    },
    async new_room(params) {
      const result = await call("new_room", { id: newId("r"), ...params });
      return { result, text: renderNewRoom(result) };
    },
    async update_room(params, handle) {
      // Account scope: the handle only supplies the room, and the Hub checks
      // that the verified account owns it.
      const { room } = decodeHandle(handle);
      const result = await call("update_room", { room, ...params });
      return { result, text: renderRoomUpdated(result, params.rotateCode === true) };
    },
    async join(params) {
      const conversation: ConversationKey = { host: "web", hostConversationId: newId("c") };
      const result = await call("join", { code: params.room, intro: params.intro, name: params.name, as: params.as,
        workspace: { repo: "", branch: "" } }, { conversation });
      const handle = encodeHandle(result.room.id, conversation);
      return { result: { ...result, conversation: handle }, text: `${renderConversationHandle(handle)}\n\n${renderJoin(result, newNonce(), hub.now())}` };
    },
    async leave(_, handle) {
      const result = await call("leave", {}, decodeHandle(handle));
      return { result, text: renderLeft(result) };
    },
    async members(_, handle) {
      const result = await call("members", {}, decodeHandle(handle));
      return { result, text: renderMembers(result, hub.now()) };
    },
    async rename(params, handle) {
      // The handle's conversation locates the member, so a connector can only
      // ever rename the member backing its own chat.
      const result = await call("rename", params, decodeHandle(handle));
      return { result, text: renderRenamed(result) };
    },
    async send(params, handle) {
      const result = await call("send", { id: newId("m"), ...params }, decodeHandle(handle));
      return { result, text: renderSent(result, hub.now()) };
    },
    async inbox(_, handle) {
      // Pull inbox consumes atomically in RoomDO before this response can leave.
      const result = await call("inbox", {}, decodeHandle(handle));
      return { result, text: renderInbox(result, newNonce()) };
    },
    async history(params, handle) {
      const result = await call("history", params, decodeHandle(handle));
      return { result, text: renderHistory(result, newNonce()) };
    },
  };

  const server = new McpServer({ name: "tandry", version: "0.1.0" });
  for (const name of connectorToolNames) {
    const { description, connector } = tools[name];
    server.registerTool(name, {
      description,
      inputSchema: toolParameters(name, "connector"),
      outputSchema: connector.output,
      annotations: {
        readOnlyHint: connector.readOnly, destructiveHint: connector.destructive,
        idempotentHint: connector.idempotent, openWorldHint: true,
      },
    }, async (params) => {
      // registerTool validated params against this tool's inputSchema.
      const run = implementations[name] as (params: unknown, handle: unknown) => Promise<Reply<ConnectorToolName>>;
      try {
        const reply = await run(params, (params as { conversation?: unknown }).conversation);
        return { content: [{ type: "text" as const, text: reply.text }], structuredContent: reply.result };
      } catch (error) {
        if (!(error instanceof TandryError)) throw error;
        return { content: [{ type: "text" as const, text: renderError(error.toBody()) }], isError: true };
      }
    });
  }
  return server;
}

// A connector's chat has no process-local marker, so join hands the model a
// handle that names the room and this chat's conversation. It locates a
// member; the verified account remains the authority.
const handleParts = z.tuple([RoomId, z.string().regex(/^c_[0-9a-z]{8,40}$/)]);

function encodeHandle(room: string, conversation: ConversationKey): string {
  return `${room}.${conversation.hostConversationId}`;
}

function decodeHandle(value: unknown): { room: string; conversation: ConversationKey } {
  const parsed = handleParts.safeParse(typeof value === "string" ? value.split(".") : null);
  if (!parsed.success) throw new TandryError("invalid_input", "Pass the conversation handle returned by join");
  return { room: parsed.data[0], conversation: { host: "web", hostConversationId: parsed.data[1] } };
}
