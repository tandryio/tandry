import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_CODES, Frame, LINK_PING, LINK_PONG, OLDEST_SUPPORTED_PROTOCOL, TandryError, fail, operations,
  type AccountId, type ErrorBody, type Result, type RoomId,
} from "@tandryio/protocol";
import type { Env } from "../env";
import type { Limits, Policy, PolicyFactory, RoomAccess } from "../policy/policy";
import type { Caller, Handled, ResolvedCaller, RoomContext } from "./context";
import { Links } from "./links";
import { delete_message, history, inbox, read, send, unreadFor } from "./mail";
import { join, leave, members, rename, resolveCaller } from "./members";
import { migrate, type MemberRow, type RoomMeta } from "./schema";

export const CALLER_HEADER = "X-Tandry-Caller";
const POLICY_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

/** What the Worker may ask of a room. `init` is the Worker's own; the rest are protocol operations. */
export type RoomOperation = "delete_room" | "init" | "join" | "leave" | "rename" | "members" | "send" | "inbox" | "read" | "history" | "delete_message";

/** The room as the Worker sees it: one method, plus fetch for the link upgrade. */
export interface RoomRpc {
  call(op: RoomOperation, caller: Caller, input: unknown, room?: { id: RoomId; ownerAccountId: AccountId }): Promise<Result<unknown>>;
  fetch(request: Request): Promise<Response>;
  invalidatePolicy(): Promise<void>;
  memberCandidates(owner: AccountId): Promise<{ id: string; name: string; host: string; lastActive: number }[]>;
}

const handlers: Record<Exclude<RoomOperation, "init" | "join" | "delete_room">, (room: RoomContext, caller: ResolvedCaller, input: never) => Handled<unknown>> = {
  leave, rename, members, send, inbox, read, history, delete_message,
};

/**
 * All of one room's state and behaviour: members, messages, read positions,
 * connections, rate limits, retention. Every operation is one local
 * transaction in a single-threaded object. The class is made per deployment
 * because the room resolves its owner's limits itself.
 */
export function createRoomDO<E extends Env = Env>(policyFor: PolicyFactory<E>) {
  return class RoomDO extends DurableObject<E> implements RoomRpc {
    meta: RoomMeta | null = null;
    readonly links: Links;
    readonly policy: Policy;
    cached: { limits: Limits; validUntil: number } | null = null;
    refreshing: Promise<void> | null = null;
    access: RoomAccess | undefined;

    constructor(state: DurableObjectState, env: E) {
      super(state, env);
      this.policy = policyFor(env);
      this.links = new Links(state, Number(env.PULL_ONLINE_MINUTES ?? 10) * 60_000);
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LINK_PING, LINK_PONG));
      state.blockConcurrencyWhile(async () => {
        this.meta = (await state.storage.get<RoomMeta>("meta")) ?? null;
        if (this.meta) migrate(state.storage.sql);
      });
    }

    /** Nothing is written for a room ID nobody created, so a guessed ID costs no storage. */
    async ensure(room: { id: RoomId; ownerAccountId: AccountId } | undefined): Promise<RoomMeta | null> {
      if (!this.meta && room) {
        this.meta = { roomId: room.id, ownerAccountId: room.ownerAccountId, retentionDays: "unlimited" };
        await this.ctx.storage.put("meta", this.meta);
        migrate(this.ctx.storage.sql);
      }
      return this.meta;
    }

    deleted(): boolean {
      return !!this.meta && this.ctx.storage.sql.exec("SELECT 1 FROM room_deleted").toArray().length > 0;
    }

    assertActive(): void {
      if (this.deleted()) throw new TandryError("not_in_room", "This room has been deleted");
    }

    /**
     * The owner's limits, resolved outside the transaction and cached until the
     * policy's own validity ends, at most a minute. Concurrent operations share
     * one fetch rather than each asking the deployment's policy provider.
     */
    async context(meta: RoomMeta): Promise<RoomContext> {
      this.assertActive();
      const now = Date.now();
      if (!this.cached || now >= this.cached.validUntil)
        await (this.refreshing ??= this.refresh(meta).finally(() => { this.refreshing = null; }));
      this.assertActive();
      if (this.access?.enabled === false) throw new TandryError("forbidden", "This room is disabled by its owner’s policy");
      return { sql: this.ctx.storage.sql, meta: this.meta!, links: this.links, now, limits: this.cached!.limits, admission: this.access?.admission };
    }

    async refresh(meta: RoomMeta): Promise<void> {
      const now = Date.now();
      const limits = await this.policy.limits(meta.ownerAccountId);
      const retentionDays = await this.policy.retention(meta.ownerAccountId, meta.roomId);
      const access = await this.policy.room?.(meta.ownerAccountId, meta.roomId);
      if (access && access.validUntil <= Date.now()) throw new TandryError("unavailable", "Room policy expired; retry");
      this.assertActive();
      this.access = access;
      this.cached = {
        limits: access ? { ...limits, membersPerRoom: access.members } : limits,
        validUntil: Math.min(now + POLICY_TTL_MS, access?.validUntil ?? Infinity),
      };
      this.applyAccess();
      if (access?.transition) {
        const departed = this.ctx.storage.sql.exec<{ account_id: string }>("SELECT DISTINCT account_id FROM member WHERE account_id NOT IN (SELECT account_id FROM member WHERE left_at IS NULL)").toArray().map(row => row.account_id);
        if (departed.length) await this.env.AUTH_DB.prepare("DELETE FROM joined_rooms WHERE room_id=? AND account_id IN (SELECT value FROM json_each(?))").bind(meta.roomId, JSON.stringify(departed)).run();
      }
      if (retentionDays !== meta.retentionDays) {
        this.meta = { ...meta, retentionDays };
        await this.ctx.storage.put("meta", this.meta);
      }
      await this.scheduleRetention();
    }

    applyAccess(): void {
      const access = this.access;
      if (!access) return;
      const sql = this.ctx.storage.sql;
      const close: string[] = [];
      this.ctx.storage.transactionSync(() => {
        sql.exec("CREATE TABLE IF NOT EXISTS policy_transition (id TEXT PRIMARY KEY)");
        sql.exec("CREATE TABLE IF NOT EXISTS policy_revision (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL)");
        const previous = sql.exec<{ revision: number }>("SELECT revision FROM policy_revision WHERE singleton=1").toArray()[0];
        if (previous && previous.revision > access.revision) throw new TandryError("unavailable", "Room policy changed; retry");
        sql.exec("INSERT INTO policy_revision VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision", access.revision);
        const transition = access.transition;
        if (transition && transition.effectiveAt <= Date.now() && !sql.exec("SELECT 1 FROM policy_transition WHERE id=?", transition.id).toArray().length) {
          const rows = sql.exec<MemberRow>("SELECT * FROM member WHERE left_at IS NULL AND joined_at<=? ORDER BY last_active_at DESC,id", transition.effectiveAt).toArray();
          const eligible = new Set(rows.map(row => row.id));
          const selected = [...new Set([...transition.preferred.filter(id => eligible.has(id)), ...rows.map(row => row.id)])].slice(0, transition.limit);
          for (const row of rows) if (!selected.includes(row.id)) {
            sql.exec("UPDATE member SET left_at=? WHERE id=?", transition.effectiveAt, row.id);
            close.push(row.id);
          }
          sql.exec("INSERT INTO policy_transition VALUES (?)", transition.id);
        }
        if (!access.enabled) close.push(...sql.exec<{ id: string }>("SELECT id FROM member WHERE left_at IS NULL").toArray().map(row => row.id));
      });
      for (const id of close) this.links.close(id, CLOSE_CODES.not_in_room, access.enabled ? "not_in_room" : "room_disabled");
    }

    /** A pushed policy change: drop the cache and re-read, after any fetch already in flight. */
    async invalidatePolicy(): Promise<void> {
      if (this.refreshing) await this.refreshing.catch(() => undefined);
      this.cached = null;
      if (this.meta) {
        try { await this.context(this.meta); }
        catch (error) { if (!(error instanceof TandryError && error.code === "forbidden")) throw error; }
      }
    }

    async memberCandidates(owner: AccountId) {
      if (!this.meta || this.meta.ownerAccountId !== owner) throw new TandryError("forbidden", "Only the room owner may select members");
      await this.context(this.meta);
      return this.ctx.storage.sql.exec<MemberRow>("SELECT * FROM member WHERE left_at IS NULL ORDER BY last_active_at DESC,id").toArray()
        .map(row => ({ id: row.id, name: `${row.account_handle}/${row.name}`, host: row.host, lastActive: row.last_active_at }));
    }

    async call(op: RoomOperation, caller: Caller, input: unknown, room?: { id: RoomId; ownerAccountId: AccountId }): Promise<Result<unknown>> {
      try {
        const meta = await this.ensure(op === "init" || op === "join" ? room : undefined);
        if (!meta) return fail("not_in_room", "No such room");
        if (op === "delete_room") {
          if (meta.ownerAccountId !== caller.accountId) return fail("forbidden", "Only the room's owner may delete it");
          this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec("INSERT OR IGNORE INTO room_deleted VALUES (1)");
            this.ctx.storage.sql.exec("DELETE FROM message");
            this.ctx.storage.sql.exec("DELETE FROM member");
          });
          for (const socket of this.ctx.getWebSockets()) {
            const member = this.links.memberOf(socket);
            if (member) this.links.close(member, CLOSE_CODES.not_in_room, "room_deleted");
          }
          await this.ctx.storage.deleteAlarm();
          return { ok: true, result: {} };
        }
        this.assertActive();
        if (op === "init") {
          if (meta.ownerAccountId !== caller.accountId) return fail("forbidden", "This room ID is already in use");
          return { ok: true, result: {} };
        }
        const context = await this.context(meta);
        this.assertActive();
        const handled = this.ctx.storage.transactionSync(() =>
          op === "join"
            ? join(context, caller, input as never)
            : handlers[op](context, resolveCaller(context, caller), input as never));
        await this.after(context, handled);
        // Only these two write messages, and so only they can create something to expire.
        if (op === "send" || op === "join") await this.scheduleRetention();
        return { ok: true, result: handled.result };
      } catch (error) {
        if (error instanceof TandryError) return { ok: false, error: error.toBody() };
        console.error(JSON.stringify({ event: "room_call_failed", op, error: String(error) }));
        return fail("unavailable", "The room could not complete the operation");
      }
    }

    /** Effects run only once the transaction has committed. */
    async after(context: RoomContext, handled: Handled<unknown>): Promise<void> {
      for (const { memberId, code, reason } of handled.effects?.close ?? []) this.links.close(memberId, code, reason);
      for (const memberId of handled.effects?.notify ?? []) this.notify(context, memberId);
      for (const event of handled.effects?.usage ?? []) {
        try { await this.policy.onUsage(event); } catch { /* metering never fails an operation */ }
      }
    }

    notify(context: RoomContext, memberId: string): void {
      const member = context.sql.exec<MemberRow>("SELECT * FROM member WHERE id=? AND left_at IS NULL", memberId).toArray()[0];
      const unread = member && unreadFor(context, member);
      if (unread) this.links.notify(memberId, unread);
    }

    /** The room link. Same check as an operation: the conversation must back a member here. */
    async fetch(request: Request): Promise<Response> {
      const reject = (error: ErrorBody, status: number) => Response.json({ ok: false, error }, { status });
      const caller = JSON.parse(request.headers.get(CALLER_HEADER) ?? "null") as Caller | null;
      if (!caller || request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return reject({ code: "invalid_input", message: "Expected a room link upgrade" }, 400);
      if (caller.protocol < OLDEST_SUPPORTED_PROTOCOL)
        return reject({ code: "upgrade_required", message: "This Tandry plugin is too old for the Hub. Update it from the host's plugin marketplace." }, 426);
      if (!this.meta) return reject({ code: "not_in_room", message: "No such room" }, 409);
      if (this.deleted()) return reject({ code: "not_in_room", message: "This room has been deleted" }, 409);
      let context: RoomContext;
      let member: MemberRow;
      try {
        context = await this.context(this.meta);
        this.assertActive();
        const resolved = resolveCaller(context, caller);
        if (resolved.kind !== "member") return reject({ code: "invalid_input", message: "A room link needs the calling conversation" }, 400);
        member = resolved.member;
      } catch (error) {
        if (error instanceof TandryError) return reject(error.toBody(), 409);
        throw error;
      }
      const pair = new WebSocketPair();
      this.links.accept(pair[1], member.id);
      context.sql.exec("UPDATE member SET last_active_at=? WHERE id=?", context.now, member.id);
      this.notify(context, member.id);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): void {
      if (typeof data !== "string") return;
      let json: unknown;
      try { json = JSON.parse(data); } catch { return; }
      const frame = Frame.safeParse(json);
      if (frame.success && frame.data.t === "state") this.links.report(socket, frame.data);
    }

    webSocketClose(socket: WebSocket, code: number): void {
      const memberId = this.links.memberOf(socket);
      if (memberId && this.meta && !this.deleted()) this.ctx.storage.sql.exec("UPDATE member SET last_active_at=? WHERE id=? AND left_at IS NULL", Date.now(), memberId);
      // Complete the closing handshake. 1005 and 1006 mean "no code" and cannot be sent back.
      if (this.links.closedByHub(socket)) return;
      try { socket.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
    }

    webSocketError(socket: WebSocket): void {
      this.webSocketClose(socket, 1011);
    }

    /**
     * Retention. A sleeping room costs nothing but its stored bytes, and an alarm
     * is a billed wake-up, so the room sets one only while it holds a message
     * that will expire: for the moment its oldest message does, and never
     * sooner than a day ahead, so expiries are swept in daily batches. A room
     * that has been emptied, or keeps messages forever, is never woken again.
     */
    async scheduleRetention(): Promise<void> {
      if (!this.meta || this.deleted()) return;
      const now = Date.now();
      const deadlines: number[] = [];
      if (this.access?.nextChangeAt && this.access.nextChangeAt > now) deadlines.push(this.access.nextChangeAt);
      if (this.meta.retentionDays !== "unlimited") {
        const oldest = this.ctx.storage.sql.exec<{ at: number | null }>("SELECT min(created_at) AS at FROM message").one().at;
        if (oldest !== null) deadlines.push(Math.max(now + DAY_MS, oldest + this.meta.retentionDays * DAY_MS));
      }
      const current = await this.ctx.storage.getAlarm();
      if (this.deleted()) return;
      if (deadlines.length) {
        const next = Math.min(...deadlines);
        if (current === null || next < current) await this.ctx.storage.setAlarm(next);
      }
    }

    async alarm(): Promise<void> {
      if (!this.meta || this.deleted()) return;
      try {
        await this.invalidatePolicy();
        if (this.deleted()) return;
        if (this.meta.retentionDays !== "unlimited")
          this.ctx.storage.sql.exec("DELETE FROM message WHERE created_at<?", Date.now() - this.meta.retentionDays * DAY_MS);
        await this.ctx.storage.deleteAlarm();
        await this.scheduleRetention();
      } catch (error) {
        if (this.deleted()) return;
        // Platform retries are bounded. Preserve a future wake through provider outages.
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
        throw error;
      }
    }

  };
}

// Keeps the handler table honest: every room-scoped protocol operation has a handler.
type RoomScoped = { [K in keyof typeof operations]: (typeof operations)[K]["scope"] extends "room" ? K : never }[keyof typeof operations];
const _exhaustive: Record<RoomScoped, unknown> = handlers;
void _exhaustive;
