import type { AccountId, RoomId } from "@tandryio/protocol";

export interface Limits {
  /** Per sender, per room. A send costs max(1, recipients). */
  sendBucket: { size: number; refillPerMinute: number };
  /** Rooms an account may own. */
  rooms: number | "unlimited";
  membersPerRoom: number;
  bodyBytes: number;
}

export type UsageEvent =
  | { type: "room_created"; account: AccountId; room: RoomId }
  | { type: "member_joined"; account: AccountId; room: RoomId }
  | { type: "message_sent"; account: AccountId; room: RoomId; recipients: number; bodyBytes: number };

/**
 * The seam between the Hub and whoever deploys it. `rooms` is read for the
 * calling account; everything else inside a room is read for the room's owner.
 */
export interface RoomAccess {
  revision: number;
  enabled: boolean;
  members: number;
  validUntil: number;
  nextChangeAt?: number;
  admission?: { cutoffAt: number; newMemberLimit: number };
  transition?: { id: string; effectiveAt: number; limit: number; preferred: string[] };
}

export interface Policy {
  /** Optional atomic reservation, idempotent on room ID. Throws when capacity is exhausted. */
  reserveRoom?(account: AccountId, room: RoomId): Promise<void>;
  /** Generic room entitlement. No billing concepts belong in the core. */
  room?(account: AccountId, room: RoomId): Promise<RoomAccess>;
  limits(account: AccountId): Promise<Limits>;
  retention(account: AccountId, room: RoomId): Promise<number | "unlimited">;
  /** Metering. Must not throw. */
  onUsage(event: UsageEvent): void | Promise<void>;
}

export interface PolicyConfig {
  ROOM_LIMIT?: string;
  MEMBERS_PER_ROOM?: string;
  BODY_BYTES?: string;
  SEND_BUCKET_SIZE?: string;
  SEND_REFILL_PER_MINUTE?: string;
  RETENTION_DAYS?: string;
}

export type PolicyFactory<E = PolicyConfig> = (env: E) => Policy;

function integer(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid policy configuration value: ${value}`);
  return parsed;
}

/** Self-hosting works with this alone. Limits come from Worker vars. */
export const defaultPolicy: PolicyFactory = (env) => {
  const limits: Limits = {
    sendBucket: { size: integer(env.SEND_BUCKET_SIZE, 60), refillPerMinute: integer(env.SEND_REFILL_PER_MINUTE, 20) },
    rooms: !env.ROOM_LIMIT || env.ROOM_LIMIT === "unlimited" ? "unlimited" : integer(env.ROOM_LIMIT, 0),
    membersPerRoom: integer(env.MEMBERS_PER_ROOM, 50),
    bodyBytes: integer(env.BODY_BYTES, 64 * 1024),
  };
  const retention = env.RETENTION_DAYS === "unlimited" ? "unlimited" : integer(env.RETENTION_DAYS, 30);
  return {
    limits: async () => limits,
    retention: async () => retention,
    onUsage() {},
  };
};
