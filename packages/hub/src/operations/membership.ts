import { TandryError, type ConversationKey, type Output, type ParsedInput, type RoomId } from "@tandryio/protocol";
import type { Principal } from "../auth/principal";
import type { Env } from "../env";
import type { LeaveResult } from "../room-do/members";
import type { RoomRpc } from "../room-do/room-do";
import type { HubContext } from "./execute";

export function roomStub(env: Env, room: RoomId): RoomRpc {
  return env.ROOM.get(env.ROOM.idFromName(room)) as unknown as RoomRpc;
}

// join and leave are the only operations that touch both stores. The room is
// authoritative; joined_rooms is a list-page index rewritten idempotently, so
// any step can fail and the whole operation can simply be retried.

export async function join(hub: HubContext, who: Principal, conversation: ConversationKey, protocol: number, input: ParsedInput<"join">, roomId?: RoomId): Promise<Output<"join">> {
  if (!who.handle) throw new TandryError("handle_required", "The account has no handle yet");
  // The code is only a joining credential: exchanged for a room ID here, it plays no further part.
  // The website names the room instead; the room admits it only for an account that can already observe it.
  if (!input.code && conversation.host !== "website") throw new TandryError("invalid_input", "join needs the room's code");
  const room = input.code ? await hub.directory.roomByCode(input.code) : roomId ? await hub.directory.roomById(roomId) : null;
  if (!room) throw new TandryError("no_such_room", input.code ? "No room has this code" : "No such room");
  const joined = await roomStub(hub.env, room.id).call("join", { accountId: who.accountId, handle: who.handle, conversation, protocol }, input, room);
  if (!joined.ok) throw TandryError.from(joined.error);
  await hub.directory.setJoined(who.accountId, room.id, true);
  return { room: { id: room.id, name: room.name, description: room.description }, ...(joined.result as Omit<Output<"join">, "room">) };
}

export async function afterLeave(hub: HubContext, room: RoomId, result: LeaveResult): Promise<Output<"leave">> {
  await hub.directory.setJoined(result.account, room, result.stillJoined);
  return { left: result.left };
}
