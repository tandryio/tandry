import type { AccountId, ConversationKey, Handle } from "@tandryio/protocol";
import type { Limits, UsageEvent } from "../policy/policy";
import type { Links } from "./links";
import type { MemberRow, RoomMeta } from "./schema";

/** Attached by the Worker after it has checked the credential. The room trusts it. */
export interface Caller {
  accountId: AccountId;
  handle: Handle | null;
  /** Absent for the website: the caller is then an observer. */
  conversation?: ConversationKey;
  protocol: number;
}

export type ResolvedCaller =
  | { kind: "member"; accountId: AccountId; member: MemberRow }
  | { kind: "observer"; accountId: AccountId; ownsRoom: boolean };

/** Everything a handler may touch. Handlers are synchronous and run inside one transaction. */
export interface RoomContext {
  sql: SqlStorage;
  meta: RoomMeta;
  links: Links;
  /** Fixed for the duration of the call. */
  now: number;
  /** The room owner's limits, resolved before the transaction. */
  limits: Limits;
  admission?: { cutoffAt: number; newMemberLimit: number };
}

/** What happens after the transaction commits. Never inside it. */
export interface Effects {
  notify?: string[];
  close?: { memberId: string; code: number; reason: string }[];
  usage?: UsageEvent[];
}

export interface Handled<T> {
  result: T;
  effects?: Effects;
}
