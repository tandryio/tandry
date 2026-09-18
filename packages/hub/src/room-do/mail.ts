import {
  ROOM_ADDRESS, TandryError, formatAddress, tierOf,
  type HistoryMessage, type MemberAddress, type MessageView, type Output, type ParsedInput, type Unread,
} from "@tandryio/protocol";
import type { Handled, ResolvedCaller, RoomContext } from "./context";
import { byAddress, memberView, present } from "./members";
import { spend } from "./rate";
import { packMembers, unpackMembers, type MemberRow, type MessageRow } from "./schema";

const INBOX_BATCH = 20;
const HISTORY_PAGE = 30;

const tag = (memberId: string) => `,${memberId},`;

/** Addresses are resolved when read, so they show each member's current name, left or not. */
function addressBook(room: RoomContext): Map<string, { address: MemberAddress; host: MemberRow["host"] }> {
  const rows = room.sql.exec<Pick<MemberRow, "id" | "account_handle" | "name" | "host">>("SELECT id, account_handle, name, host FROM member").toArray();
  return new Map(rows.map((row) => [row.id, { address: formatAddress(row.account_handle, row.name), host: row.host }]));
}

function views(room: RoomContext, rows: MessageRow[]): MessageView[] {
  if (!rows.length) return [];
  const book = addressBook(room);
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    from: book.get(row.from_member)!.address,
    fromHost: book.get(row.from_member)!.host,
    visibility: row.visibility,
    to: unpackMembers(row.to_members).map((id) => book.get(id)!.address),
    toRoom: !!row.to_room,
    ...(row.reply_to ? { replyTo: row.reply_to } : {}),
    kind: row.kind,
    body: row.body,
    ...(row.meta ? { meta: JSON.parse(row.meta) as Record<string, string> } : {}),
    createdAt: row.created_at,
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  }));
}

/** What is unread for a member beyond `after`: the shape of a notify frame. */
export function unreadFor(room: RoomContext, member: Pick<MemberRow, "id" | "read_seq">, after = member.read_seq): Unread | null {
  const rows = room.sql.exec<{ seq: number; from_member: string }>(
    "SELECT seq, from_member FROM message WHERE deleted_at IS NULL AND seq>? AND instr(to_members, ?) > 0 ORDER BY seq", after, tag(member.id),
  ).toArray();
  if (!rows.length) return null;
  const book = addressBook(room);
  return { unread: rows.length, upTo: rows[rows.length - 1]!.seq, from: [...new Set(rows.map((row) => book.get(row.from_member)!.address))] };
}

/**
 * What a caller may read: the room's public messages, plus the dms it took
 * part in. A member reads as itself; an observer reads as every member its
 * account has or had here, because an owner sees all its members' mail.
 */
function readableBy(room: RoomContext, caller: ResolvedCaller, view?: ParsedInput<"history">["view"]): { clause: string; bindings: string[] } {
  const ids = caller.kind === "member"
    ? [caller.member.id]
    : room.sql.exec<{ id: string }>("SELECT id FROM member WHERE account_id=?", caller.accountId).toArray().map((row) => row.id);
  const mine = ids.map(() => "from_member=? OR instr(to_members, ?) > 0").join(" OR ");
  if (view === "room") return { clause: "visibility='room'", bindings: [] };
  if (view === "correspondence") return { clause: `(${mine || "0"})`, bindings: ids.flatMap((id) => [id, tag(id)]) };
  return { clause: `(visibility='room'${mine ? ` OR ${mine}` : ""})`, bindings: ids.flatMap((id) => [id, tag(id)]) };
}

function page(room: RoomContext, caller: ResolvedCaller, before: number | undefined, view?: ParsedInput<"history">["view"]): Output<"history"> {
  const readable = readableBy(room, caller, view);
  const rows = room.sql.exec<MessageRow>(
    `SELECT * FROM message WHERE seq<? AND ${readable.clause} ORDER BY seq DESC LIMIT ${HISTORY_PAGE + 1}`,
    before ?? Number.MAX_SAFE_INTEGER, ...readable.bindings,
  ).toArray();
  const shown = rows.slice(0, HISTORY_PAGE).reverse();
  const messages: HistoryMessage[] = views(room, shown);
  if (caller.kind === "observer" && shown.length) {
    const book = new Map(room.sql.exec<MemberRow>("SELECT * FROM member").toArray().map((row) => [row.id, row]));
    const visible = readableBy(room, caller);
    const replies = room.sql.exec<Pick<MessageRow, "reply_to" | "from_member">>(
      `SELECT reply_to, from_member FROM message WHERE reply_to IN (${shown.map(() => "?").join(",")}) AND ${visible.clause}`,
      ...shown.map((row) => row.id), ...visible.bindings,
    ).toArray();
    messages.forEach((message, index) => {
      const row = shown[index]!;
      message.owned = book.get(row.from_member)!.account_id === caller.accountId;
      message.recipients = unpackMembers(row.to_members).map((id) => {
        const recipient = book.get(id)!;
        const state = replies.some((reply) => reply.reply_to === row.id && reply.from_member === id) ? "replied"
          : recipient.read_seq >= row.seq ? "read" : recipient.left_at !== null ? "left" : "unread";
        return { address: formatAddress(recipient.account_handle, recipient.name), state };
      });
    });
  }
  return { messages, nextBefore: rows.length > HISTORY_PAGE ? shown[0]!.seq : null };
}

export function recentHistory(room: RoomContext, caller: ResolvedCaller): MessageView[] {
  return page(room, caller, undefined).messages;
}

// ---- handlers ------------------------------------------------------------

function isMember(caller: ResolvedCaller): asserts caller is Extract<ResolvedCaller, { kind: "member" }> {
  if (caller.kind !== "member") throw new TandryError("invalid_input", "This operation needs the calling conversation");
}

export function send(room: RoomContext, caller: ResolvedCaller, input: ParsedInput<"send">): Handled<Output<"send">> {
  isMember(caller);
  const sender = caller.member;
  const recipientsOf = (ids: string[]) => ids.map((id) => {
    const row = room.sql.exec<MemberRow>("SELECT * FROM member WHERE id=?", id).one();
    return { address: formatAddress(row.account_handle, row.name), ...room.links.presence(row, room.now) };
  });

  // The message ID is the idempotency key: a retry gets the first attempt's message back.
  const existing = room.sql.exec<MessageRow>("SELECT * FROM message WHERE id=?", input.id).toArray()[0];
  if (existing) {
    if (existing.from_member !== sender.id) throw new TandryError("invalid_input", "This message ID is already in use");
    return { result: { id: existing.id, seq: existing.seq, recipients: recipientsOf(unpackMembers(existing.to_members)) } };
  }

  if (new TextEncoder().encode(input.body).length > room.limits.bodyBytes)
    throw new TandryError("limit_reached", `The message body exceeds ${room.limits.bodyBytes} bytes`);

  let visibility: "room" | "dm" = input.dm ? "dm" : "room";
  let to: MemberRow[];
  if (input.to === ROOM_ADDRESS) {
    // Expanded now: the recipients are a fact of the moment of sending.
    to = present(room).filter((row) => row.id !== sender.id);
  } else {
    const unknown = input.to.filter((address) => !byAddress(room, address));
    if (unknown.length)
      throw new TandryError("no_such_member", `No member ${unknown.join(", ")} in the room`, { members: present(room).map((row) => memberView(room, row, caller)) });
    to = input.to.map((address) => byAddress(room, address)!);
  }

  if (input.replyTo) {
    const original = room.sql.exec<MessageRow>("SELECT * FROM message WHERE id=?", input.replyTo).toArray()[0];
    const participants = original ? [original.from_member, ...unpackMembers(original.to_members)] : [];
    if (!original || (original.visibility === "dm" && !participants.includes(sender.id)))
      throw new TandryError("no_such_message", `No readable message ${input.replyTo}`);
    // A reply stays where the conversation is: same visibility as what it answers.
    visibility = original.visibility;
    if (input.to !== ROOM_ADDRESS && !input.to.length) {
      // Room message: the sender; the rest can read it in the history. dm: everyone, so a group dm stays whole.
      const defaults = original.visibility === "room" ? [original.from_member] : participants;
      to = present(room).filter((row) => defaults.includes(row.id));
    }
  }

  const ids = [...new Set(to.map((row) => row.id))].filter((id) => id !== sender.id);
  if (visibility === "dm" && !ids.length) throw new TandryError("invalid_input", "A dm must name at least one recipient who is still in the room");

  // Messages without recipients are charged too.
  const paid = spend(sender, Math.max(1, ids.length), room.limits.sendBucket, room.now);
  if (!paid.ok) throw new TandryError("rate_limited", "This member is sending too fast", { retryAfterSeconds: paid.retryAfterSeconds });

  room.sql.exec("UPDATE member SET bucket_tokens=?, bucket_at=?, last_active_at=? WHERE id=?", paid.tokens, room.now, room.now, sender.id);
  const seq = room.sql.exec<{ seq: number }>(
    "INSERT INTO message (id, from_member, visibility, to_members, to_room, reply_to, kind, body, meta, created_at) VALUES (?,?,?,?,?,?,'text',?,?,?) RETURNING seq",
    input.id, sender.id, visibility, packMembers(ids), input.to === ROOM_ADDRESS ? 1 : 0, input.replyTo ?? null,
    input.body, input.meta ? JSON.stringify(input.meta) : null, room.now,
  ).one().seq;

  return {
    result: { id: input.id, seq, recipients: recipientsOf(ids) },
    effects: {
      notify: ids,
      usage: [{ type: "message_sent", account: sender.account_id, room: room.meta.roomId, recipients: ids.length, bodyBytes: input.body.length }],
    },
  };
}

/** Push peeks; pull consumes inside this same transaction, including concurrent reads. */
export function inbox(room: RoomContext, caller: ResolvedCaller): Handled<Output<"inbox">> {
  isMember(caller);
  const member = caller.member;
  room.sql.exec("UPDATE member SET last_active_at=? WHERE id=?", room.now, member.id);
  const rows = room.sql.exec<MessageRow>(
    `SELECT * FROM message WHERE deleted_at IS NULL AND seq>? AND instr(to_members, ?) > 0 ORDER BY seq LIMIT ${INBOX_BATCH}`, member.read_seq, tag(member.id),
  ).toArray();
  const upTo = rows.length ? rows[rows.length - 1]!.seq : 0;
  if (upTo && tierOf(member.host) === "pull") read(room, caller, { upTo });
  return { result: { messages: views(room, rows), upTo, remaining: rows.length ? unreadFor(room, member, upTo) : null } };
}

export function read(room: RoomContext, caller: ResolvedCaller, input: ParsedInput<"read">): Handled<Output<"read">> {
  isMember(caller);
  const latest = room.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM message").one().seq ?? 0;
  const readSeq = Math.max(caller.member.read_seq, Math.min(input.upTo, latest));
  room.sql.exec("UPDATE member SET read_seq=?, last_active_at=? WHERE id=?", readSeq, room.now, caller.member.id);
  return { result: { readSeq } };
}

export function history(room: RoomContext, caller: ResolvedCaller, input: ParsedInput<"history">): Handled<Output<"history">> {
  return { result: page(room, caller, input.before, input.view) };
}

/** Preserve the idempotency key and routing headers; content cannot reappear on send retry. */
export function delete_message(room: RoomContext, caller: ResolvedCaller, input: ParsedInput<"delete_message">): Handled<Output<"delete_message">> {
  const row = room.sql.exec<MessageRow>(
    "SELECT message.* FROM message JOIN member ON member.id=message.from_member WHERE message.id=? AND member.account_id=?",
    input.id, caller.accountId,
  ).toArray()[0];
  if (!row) throw new TandryError("no_such_message", "No message owned by this account");
  room.sql.exec("UPDATE message SET body='', meta=NULL, deleted_at=coalesce(deleted_at, ?) WHERE id=?", room.now, row.id);
  if (row.kind === "intro") room.sql.exec("UPDATE member SET intro='' WHERE id=? AND intro=?", row.from_member, row.body);
  return { result: {}, effects: { notify: unpackMembers(row.to_members) } };
}
