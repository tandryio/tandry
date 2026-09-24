import {
  OLDEST_SUPPORTED_PROTOCOL, TandryError, fail, isOperationName, operations,
  type ConversationKey, type Output, type Result, type RoomId,
} from "@tandryio/protocol";
import { withAvatars } from "../avatars/avatars";
import type { Principal } from "../auth/principal";
import type { Directory } from "../directory/directory";
import type { Env } from "../env";
import type { Policy } from "../policy/policy";
import type { LeaveResult } from "../room-do/members";
import type { RoomOperation } from "../room-do/room-do";
import * as account from "./account";
import { afterLeave, join, roomStub } from "./membership";

export interface HubContext {
  env: Env;
  policy: Policy;
  directory: Directory;
  now: () => number;
}

export interface OperationRequest {
  op: string;
  /** Resolved by the binding. Past this point the kind of credential no longer matters. */
  principal: Principal | null;
  protocol: number;
  room?: RoomId;
  conversation?: ConversationKey;
  input: unknown;
}

/**
 * The one entry every binding uses. It is the whole check chain: protocol
 * version, input, credential, and — by handing room-scoped operations to the
 * room — membership. Operation implementations contain no authorization.
 */
export async function execute(hub: HubContext, request: OperationRequest): Promise<Result<unknown>> {
  try {
    if (request.protocol < OLDEST_SUPPORTED_PROTOCOL)
      return fail("upgrade_required", "This Tandry plugin is too old for the Hub. Update it from the host's plugin marketplace.");
    if (!isOperationName(request.op)) return fail("invalid_input", `Unknown operation ${request.op}`);
    const definition = operations[request.op];
    const parsed = definition.input.safeParse(request.input ?? {});
    if (!parsed.success) return fail("invalid_input", parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
    const input = parsed.data as never;

    if (definition.name === "login_start") return { ok: true, result: await account.login_start(hub) };
    if (definition.name === "login_status") return { ok: true, result: await account.login_status(hub, input) };

    const who = request.principal;
    if (!who) return fail("not_logged_in", "Sign in to Tandry first");
    // host="website" tells readers a person typed the message, so only a website session may claim it.
    if (request.conversation?.host === "website" && who.via !== "session")
      return fail("forbidden", "Only the Tandry website may act as a website member");

    switch (definition.name) {
      case "logout": return { ok: true, result: await account.logout(hub, who) };
      case "status": return { ok: true, result: await account.status(hub, who) };
      case "devices": return { ok: true, result: await account.devices(hub, who) };
      case "revoke_device": return { ok: true, result: await account.revoke_device(hub, who, input) };
      case "new_room": return { ok: true, result: await account.new_room(hub, who, input) };
      case "delete_room": return { ok: true, result: await account.delete_room(hub, who, input) };
      case "update_room": return { ok: true, result: await account.update_room(hub, who, input) };
      case "join":
        if (!request.conversation) return fail("invalid_input", "join needs the calling conversation");
        return { ok: true, result: await join(hub, who, request.conversation, request.protocol, input, request.room) };
    }

    if (!request.room) return fail("invalid_input", `${definition.name} needs a room`);
    if (definition.caller === "member" && !request.conversation) return fail("invalid_input", `${definition.name} needs the calling conversation`);
    const result = await roomStub(hub.env, request.room).call(
      definition.name as RoomOperation,
      { accountId: who.accountId, handle: who.handle, conversation: request.conversation, protocol: request.protocol },
      input,
    );
    if (result.ok && definition.name === "leave") return { ok: true, result: await afterLeave(hub, request.room, result.result as LeaveResult) };
    // Pictures are for the website's member list; a conversation reads addresses.
    if (result.ok && definition.name === "members" && !request.conversation) {
      const { members } = result.result as Output<"members">;
      return { ok: true, result: { members: await withAvatars(hub.env.AUTH_DB, members) } };
    }
    return result;
  } catch (error) {
    if (error instanceof TandryError) return { ok: false, error: error.toBody() };
    console.error(JSON.stringify({ event: "operation_failed", op: request.op, error: String(error) }));
    return fail("unavailable", "The Hub could not complete the operation");
  }
}
