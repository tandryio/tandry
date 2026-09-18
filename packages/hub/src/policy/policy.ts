import type { AccountId, RoomId } from "@tandryio/protocol";

export interface Limits {
  /** Per sender, per room. A send costs max(1, recipients). */
  sendBucket: { size: number; refillPerMinute: number };
  /** Rooms an account may own. */
  rooms: number;
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
export interface Policy {
  limits(account: AccountId): Promise<Limits>;
  retention(account: AccountId, room: RoomId): Promise<number | "unlimited">;
  /** Metering. Must not throw. */
  onUsage(event: UsageEvent): void;
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
    rooms: integer(env.ROOM_LIMIT, 100),
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
