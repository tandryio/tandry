import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  Handle, PROTOCOL_VERSION, RoomId, TandryError, newId, newNonce, operations,
  renderConversationHandle, renderError, renderHistory, renderInbox, renderJoin, renderLeft,
  renderMembers, renderNewRoom, renderRenamed, renderRoomUpdated, renderSent, renderStatus, toolParameters, tools,
  type ConversationKey, type Input, type OperationName, type Output, type ToolName, type ToolParams,
} from "@tandryio/protocol";
import { z } from "zod";
import { authFor } from "../auth/auth";
import type { Principal } from "../auth/principal";
import { execute, type HubContext } from "../operations/execute";

const handleParts = z.tuple([RoomId, z.string().regex(/^c_[0-9a-z]{8,40}$/)]);
type ConnectorTool = Exclude<ToolName, "login">;

/** The handle locates a member; the verified account remains the authority. */
function decodeHandle(value: unknown): { room: string; conversation: ConversationKey } {
  const parsed = handleParts.safeParse(typeof value === "string" ? value.split(".") : null);
  if (!parsed.success) throw new TandryError("invalid_input", "Pass the conversation handle returned by join");
  return { room: parsed.data[0], conversation: { host: "web", hostConversationId: parsed.data[1] } };
}

function connectorServer(hub: HubContext, who: Principal) {
  const server = new McpServer({ name: "tandry", version: "0.1.0" });
  async function call<K extends OperationName>(op: K, input: Input<K>, context: { room?: string; conversation?: ConversationKey } = {}): Promise<Output<K>> {
    const result = await execute(hub, { op, input, principal: who, protocol: PROTOCOL_VERSION, ...context });
    if (!result.ok) throw new TandryError(result.error.code, result.error.message, result.error.data);
    return operations[op].output.parse(result.result) as Output<K>;
  }
  const implementations: { [K in ConnectorTool]: (params: ToolParams<K>, handle?: unknown) => Promise<string> } = {
    async status() {
      const result = await call("status", {});
      return renderStatus({ ...result, current: null, inactive: null });
    },
    async new_room(params) {
      return renderNewRoom(await call("new_room", { id: newId("r"), ...params }));
    },
    async update_room(params, handle) {
      // Account scope: the handle only supplies the room, and the Hub checks
      // that the verified account owns it.
      const { room } = decodeHandle(handle);
      return renderRoomUpdated(await call("update_room", { room, ...params }), params.rotateCode === true);
    },
    async join(params) {
      const conversation: ConversationKey = { host: "web", hostConversationId: newId("c") };
      const result = await call("join", { code: params.room, intro: params.intro, name: params.name, as: params.as,
        workspace: { repo: "", branch: "" } }, { conversation });
      return `${renderConversationHandle(`${result.room.id}.${conversation.hostConversationId}`)}\n\n${renderJoin(result, newNonce(), hub.now())}`;
    },
    async leave(_, handle) {
      return renderLeft(await call("leave", {}, decodeHandle(handle)));
    },
    async members(_, handle) {
      return renderMembers(await call("members", {}, decodeHandle(handle)), hub.now());
    },
    async rename(params, handle) {
      // The handle's conversation locates the member, so a connector can only
      // ever rename the member backing its own chat.
      return renderRenamed(await call("rename", params, decodeHandle(handle)));
    },
    async send(params, handle) {
      return renderSent(await call("send", { id: newId("m"), ...params }, decodeHandle(handle)), hub.now());
    },
    async inbox(_, handle) {
      // Pull inbox consumes atomically in RoomDO before this response can leave.
      return renderInbox(await call("inbox", {}, decodeHandle(handle)), newNonce());
    },
    async history(params, handle) {
      return renderHistory(await call("history", params, decodeHandle(handle)), newNonce());
    },
  };
  for (const name of Object.keys(tools) as ToolName[]) {
    if (!tools[name].connector || name === "login") continue;
    const readOnly = name === "status" || name === "members" || name === "history";
    server.registerTool(name, {
      description: tools[name].description,
      inputSchema: toolParameters(name, "connector"),
      annotations: {
        readOnlyHint: readOnly,
        // Continuing a member can replace its conversation; leaving abandons
        // unread; rotating the code stops the old one admitting anyone, and
        // renaming stops a member's old address resolving.
        destructiveHint: name === "join" || name === "leave" || name === "update_room" || name === "rename",
        // Each pull consumes a batch; retrying inbox can return the next batch.
        // A repeated rename lands on the same name, but a repeated rotate does not.
        idempotentHint: readOnly || name === "leave" || name === "rename",
        openWorldHint: true,
      },
    }, async (params) => {
      try {
        const text = await implementations[name](params as never, "conversation" in params ? params.conversation : undefined);
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        if (!(error instanceof TandryError)) throw error;
        return { content: [{ type: "text" as const, text: renderError(error.toBody()) }], isError: true };
      }
    });
  }
  return server;
}

/** OAuth and protocol state are request-scoped; the room owns all conversation state. */
export async function mcpBinding(request: Request, hub: HubContext): Promise<Response> {
  const auth = authFor(hub.env);
  return requireMcpAuth(auth, async (verifiedRequest, claims) => {
    if (typeof claims.sub !== "string") return new Response("Account required", { status: 403 });
    const account = await hub.env.AUTH_DB.prepare("SELECT id, handle FROM user WHERE id=?").bind(claims.sub).first<{ id: string; handle: string | null }>();
    if (!account) return new Response("Account required", { status: 403 });
    const handle = Handle.safeParse(account.handle);
    const who: Principal = { accountId: account.id, handle: handle.success ? handle.data : null, via: "connector" };
    return createMcpHandler(() => connectorServer(hub, who), { legacy: "stateless" }).fetch(verifiedRequest);
  }, { resource: `${hub.env.BETTER_AUTH_URL}/mcp`, requiredScopes: ["tandry"] })(request);
}
