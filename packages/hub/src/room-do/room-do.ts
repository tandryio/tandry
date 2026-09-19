import { DurableObject } from "cloudflare:workers";
import {
  Frame, OLDEST_SUPPORTED_PROTOCOL, TandryError, fail, operations,
  type AccountId, type ErrorBody, type Result, type RoomId,
} from "@tandryio/protocol";
import type { Env } from "../env";
import type { Limits, Policy, PolicyFactory } from "../policy/policy";
import type { Caller, Handled, ResolvedCaller, RoomContext } from "./context";
import { Links } from "./links";
import { delete_message, history, inbox, read, send, unreadFor } from "./mail";
import { join, leave, members, rename, resolveCaller } from "./members";
import { migrate, type MemberRow, type RoomMeta } from "./schema";

export const CALLER_HEADER = "X-Tandry-Caller";
const POLICY_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

/** What the Worker may ask of a room. `init` is the Worker's own; the rest are protocol operations. */
export type RoomOperation = "init" | "join" | "leave" | "rename" | "members" | "send" | "inbox" | "read" | "history" | "delete_message";

/** The room as the Worker sees it: one method, plus fetch for the link upgrade. */
export interface RoomRpc {
  call(op: RoomOperation, caller: Caller, input: unknown, room?: { id: RoomId; ownerAccountId: AccountId }): Promise<Result<unknown>>;
  fetch(request: Request): Promise<Response>;
}

const handlers: Record<Exclude<RoomOperation, "init" | "join">, (room: RoomContext, caller: ResolvedCaller, input: never) => Handled<unknown>> = {
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
    cached: { limits: Limits; at: number } | null = null;

    constructor(state: DurableObjectState, env: E) {
      super(state, env);
      this.policy = policyFor(env);
      this.links = new Links(state, Number(env.PULL_ONLINE_MINUTES ?? 10) * 60_000);
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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

    /** The owner's limits, resolved outside the transaction and cached briefly. */
    async context(meta: RoomMeta): Promise<RoomContext> {
      const now = Date.now();
      if (!this.cached || now - this.cached.at > POLICY_TTL_MS) {
        const [limits, retentionDays] = await Promise.all([
          this.policy.limits(meta.ownerAccountId), this.policy.retention(meta.ownerAccountId, meta.roomId),
        ]);
        this.cached = { limits, at: now };
        if (retentionDays !== meta.retentionDays) {
          this.meta = { ...meta, retentionDays };
          await this.ctx.storage.put("meta", this.meta);
        }
        await this.scheduleRetention();
      }
      return { sql: this.ctx.storage.sql, meta: this.meta!, links: this.links, now, limits: this.cached.limits };
    }

    async call(op: RoomOperation, caller: Caller, input: unknown, room?: { id: RoomId; ownerAccountId: AccountId }): Promise<Result<unknown>> {
      try {
        const meta = await this.ensure(op === "init" || op === "join" ? room : undefined);
        if (!meta) return fail("not_in_room", "No such room");
        if (op === "init") return { ok: true, result: {} };
        const context = await this.context(meta);
        const handled = this.ctx.storage.transactionSync(() =>
          op === "join"
            ? join(context, caller, input as never)
            : handlers[op](context, resolveCaller(context, caller), input as never));
        this.after(context, handled);
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
    after(context: RoomContext, handled: Handled<unknown>): void {
      for (const { memberId, code, reason } of handled.effects?.close ?? []) this.links.close(memberId, code, reason);
      for (const memberId of handled.effects?.notify ?? []) this.notify(context, memberId);
      for (const event of handled.effects?.usage ?? []) {
        try { this.policy.onUsage(event); } catch { /* metering never fails an operation */ }
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
      const context = await this.context(this.meta);
      let member: MemberRow;
      try {
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
      if (memberId && this.meta) this.ctx.storage.sql.exec("UPDATE member SET last_active_at=? WHERE id=? AND left_at IS NULL", Date.now(), memberId);
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
      if (!this.meta || this.meta.retentionDays === "unlimited") return;
      if (await this.ctx.storage.getAlarm()) return;
      const oldest = this.ctx.storage.sql.exec<{ at: number | null }>("SELECT min(created_at) AS at FROM message").one().at;
      if (oldest === null) return;
      const now = Date.now();
      await this.ctx.storage.setAlarm(Math.max(now + DAY_MS, oldest + this.meta.retentionDays * DAY_MS));
    }

    async alarm(): Promise<void> {
      if (!this.meta || this.meta.retentionDays === "unlimited") return;
      this.ctx.storage.sql.exec("DELETE FROM message WHERE created_at<?", Date.now() - this.meta.retentionDays * DAY_MS);
      await this.scheduleRetention();
    }
  };
}

// Keeps the handler table honest: every room-scoped protocol operation has a handler.
type RoomScoped = { [K in keyof typeof operations]: (typeof operations)[K]["scope"] extends "room" ? K : never }[keyof typeof operations];
const _exhaustive: Record<RoomScoped, unknown> = handlers;
void _exhaustive;
