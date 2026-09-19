import {
  CLOSE_CODES, formatAddress, newId, parseAddress, TandryError, toMemberName,
  type MemberAddress, type MemberView, type Output, type ParsedInput,
} from "@tandryio/protocol";
import type { Caller, Handled, ResolvedCaller, RoomContext } from "./context";
import { recentHistory, unreadFor } from "./mail";
import type { MemberRow } from "./schema";

export function addressOf(member: Pick<MemberRow, "account_handle" | "name">): MemberAddress {
  return formatAddress(member.account_handle, member.name);
}

export function present(room: RoomContext): MemberRow[] {
  return room.sql.exec<MemberRow>("SELECT * FROM member WHERE left_at IS NULL ORDER BY joined_at, id").toArray();
}

/** An address resolves by name to the row that has not left. */
export function byAddress(room: RoomContext, address: MemberAddress): MemberRow | null {
  const { handle, name } = parseAddress(address);
  return room.sql.exec<MemberRow>("SELECT * FROM member WHERE account_handle=? AND name=? AND left_at IS NULL", handle, name).toArray()[0] ?? null;
}

function byConversation(room: RoomContext, caller: Caller): MemberRow | null {
  if (!caller.conversation) return null;
  return room.sql.exec<MemberRow>(
    "SELECT * FROM member WHERE account_id=? AND host=? AND host_conversation_id=? AND left_at IS NULL",
    caller.accountId, caller.conversation.host, caller.conversation.hostConversationId,
  ).toArray()[0] ?? null;
}

/**
 * The last step of the check chain. With a conversation the caller must be the
 * member it backs: account, host and host conversation ID all match, and it
 * has not left. Without one the caller is an observer: the room's owner, or an
 * account with a member in the room.
 */
export function resolveCaller(room: RoomContext, caller: Caller): ResolvedCaller {
  if (caller.conversation) {
    const member = byConversation(room, caller);
    if (!member) throw new TandryError("not_in_room", "This conversation does not back a member of this room");
    return { kind: "member", accountId: caller.accountId, member };
  }
  const ownsRoom = room.meta.ownerAccountId === caller.accountId;
  const hasMember = room.sql.exec("SELECT 1 FROM member WHERE account_id=? AND left_at IS NULL LIMIT 1", caller.accountId).toArray().length > 0;
  if (!ownsRoom && !hasMember) throw new TandryError("forbidden", "This account neither owns the room nor has a member in it");
  return { kind: "observer", accountId: caller.accountId, ownsRoom };
}

export function memberView(room: RoomContext, member: MemberRow, viewer: ResolvedCaller): MemberView {
  const me = viewer.kind === "member" && viewer.member.id === member.id;
  const unreadFromMe = viewer.kind === "member" && !me
    ? room.sql.exec<{ n: number }>(
        "SELECT count(*) AS n FROM message WHERE deleted_at IS NULL AND from_member=? AND seq>? AND instr(to_members, ?) > 0",
        viewer.member.id, member.read_seq, `,${member.id},`,
      ).one().n
    : 0;
  return {
    ...room.links.presence(member, room.now),
    address: addressOf(member),
    host: member.host,
    workspace: { repo: member.workspace_repo, branch: member.workspace_branch },
    intro: member.intro,
    joinedAt: member.joined_at,
    unreadFromMe,
    me,
    ...(viewer.kind === "observer" ? { owned: member.account_id === viewer.accountId } : {}),
  };
}

function freeName(room: RoomContext, handle: string, wanted: string): string {
  const taken = new Set(room.sql.exec<{ name: string }>("SELECT name FROM member WHERE account_handle=? AND left_at IS NULL", handle).toArray().map((row) => row.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted.slice(0, 40 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---- handlers ------------------------------------------------------------

export function join(room: RoomContext, caller: Caller, input: ParsedInput<"join">): Handled<Omit<Output<"join">, "room">> {
  const conversation = caller.conversation!;
  const handle = caller.handle!;
  const effects: Handled<unknown>["effects"] = {};
  let member = byConversation(room, caller);
  let outcome: Output<"join">["outcome"] = "reused";

  if (member && input.as && input.as !== member.name)
    throw new TandryError("already_in_room", `This conversation already backs ${addressOf(member)} here. Leave first to continue another member.`);

  if (!member && input.as) {
    // Continuation: only a member that is still in the room, owned by the same account.
    member = room.sql.exec<MemberRow>("SELECT * FROM member WHERE account_id=? AND name=? AND left_at IS NULL", caller.accountId, input.as).toArray()[0] ?? null;
    if (!member)
      throw new TandryError("no_such_member", `This account has no member named ${input.as} in the room`, {
        members: present(room).filter((row) => row.account_id === caller.accountId).map((row) => memberView(room, row, { kind: "observer", accountId: caller.accountId, ownsRoom: false })),
      });
    room.sql.exec(
      "UPDATE member SET host=?, host_conversation_id=?, workspace_repo=?, workspace_branch=?, intro=?, last_active_at=? WHERE id=?",
      conversation.host, conversation.hostConversationId, input.workspace.repo, input.workspace.branch, input.intro, room.now, member.id,
    );
    effects.close = [{ memberId: member.id, code: CLOSE_CODES.rebound, reason: "rebound" }];
    outcome = "continued";
  } else if (!member) {
    const admissionLimit = room.admission?.newMemberLimit ?? room.limits.membersPerRoom;
    if (present(room).length >= admissionLimit)
      throw new TandryError("limit_reached", `The room is full (${room.limits.membersPerRoom} members)`);
    const id = newId("mb", room.now);
    const name = freeName(room, handle, input.name ?? toMemberName(input.workspace.repo) ?? conversation.host);
    // A new row is in no earlier message's recipients, so it has no unread by
    // construction; read_seq only tells the unread query where to start.
    const readSeq = room.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM message").one().seq ?? 0;
    room.sql.exec(
      `INSERT INTO member (id, account_id, account_handle, name, intro, host, host_conversation_id, workspace_repo, workspace_branch,
         read_seq, joined_at, left_at, last_active_at, bucket_tokens, bucket_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
      id, caller.accountId, handle, name, input.intro, conversation.host, conversation.hostConversationId,
      input.workspace.repo, input.workspace.branch, readSeq, room.now, room.now, room.limits.sendBucket.size, room.now,
    );
    // The intro enters the room history with nobody in `to`, so nobody is woken.
    room.sql.exec(
      "INSERT INTO message (id, from_member, visibility, to_members, to_room, reply_to, kind, body, meta, created_at) VALUES (?,?,'room','',0,NULL,'intro',?,NULL,?)",
      newId("m", room.now), id, input.intro, room.now,
    );
    effects.usage = [{ type: "member_joined", account: caller.accountId, room: room.meta.roomId }];
    outcome = "joined";
  }

  const self = byConversation(room, caller)!;
  const viewer: ResolvedCaller = { kind: "member", accountId: caller.accountId, member: self };
  const everyone = present(room);
  return {
    result: {
      member: addressOf(self),
      outcome,
      members: everyone.map((row) => memberView(room, row, viewer)),
      history: recentHistory(room, viewer),
      unread: unreadFor(room, self)?.unread ?? 0,
      offline: everyone
        .filter((row) => row.account_id === caller.accountId && row.id !== self.id && room.links.presence(row, room.now).state === "offline")
        .map(addressOf),
    },
    effects,
  };
}

/** The member itself, its owner, or the room's owner may end a member. */
function target(room: RoomContext, caller: ResolvedCaller, address: MemberAddress | undefined, allowRoomOwner: boolean): MemberRow {
  if (!address) {
    if (caller.kind !== "member") throw new TandryError("invalid_input", "Name the member");
    return caller.member;
  }
  const member = byAddress(room, address);
  if (!member) throw new TandryError("no_such_member", `No member ${address} in the room`, { members: present(room).map((row) => memberView(room, row, caller)) });
  const ownsRoom = room.meta.ownerAccountId === caller.accountId;
  if (member.account_id !== caller.accountId && !(allowRoomOwner && ownsRoom)) throw new TandryError("forbidden", `${address} belongs to another account`);
  return member;
}

export interface LeaveResult {
  left: MemberAddress;
  /** For the Worker's joined index: whose member it was, and whether that account still has one here. */
  account: string;
  stillJoined: boolean;
}

export function leave(room: RoomContext, caller: ResolvedCaller, input: ParsedInput<"leave">): Handled<LeaveResult> {
  const member = target(room, caller, input.member, true);
  room.sql.exec("UPDATE member SET left_at=?, last_active_at=? WHERE id=?", room.now, room.now, member.id);
  const stillJoined = room.sql.exec("SELECT 1 FROM member WHERE account_id=? AND left_at IS NULL LIMIT 1", member.account_id).toArray().length > 0;
  return {
    result: { left: addressOf(member), account: member.account_id, stillJoined },
    effects: { close: [{ memberId: member.id, code: CLOSE_CODES.not_in_room, reason: "not_in_room" }] },
  };
}

export function rename(room: RoomContext, caller: ResolvedCaller, input: ParsedInput<"rename">): Handled<Output<"rename">> {
  const member = target(room, caller, input.member, false);
  if (member.name !== input.name) {
    if (byAddress(room, formatAddress(member.account_handle, input.name))) throw new TandryError("name_taken", `${input.name} is already used by another of this account's members`);
    room.sql.exec("UPDATE member SET name=? WHERE id=?", input.name, member.id);
  }
  return { result: { member: formatAddress(member.account_handle, input.name) } };
}

export function members(room: RoomContext, caller: ResolvedCaller): Handled<Output<"members">> {
  return { result: { members: present(room).map((row) => memberView(room, row, caller)) } };
}
