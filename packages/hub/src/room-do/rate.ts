import type { Limits } from "../policy/policy";
import type { MemberRow } from "./schema";

/**
 * Token bucket kept on the sender's member row, so it survives eviction.
 * Returns the new bucket, or the seconds to wait when the cost cannot be paid.
 */
export function spend(member: Pick<MemberRow, "bucket_tokens" | "bucket_at">, cost: number, bucket: Limits["sendBucket"], now: number):
  { ok: true; tokens: number } | { ok: false; retryAfterSeconds: number } {
  const refilled = Math.min(bucket.size, member.bucket_tokens + ((now - member.bucket_at) / 60_000) * bucket.refillPerMinute);
  if (refilled >= cost) return { ok: true, tokens: refilled - cost };
  const missing = Math.min(cost, bucket.size) - refilled;
  return { ok: false, retryAfterSeconds: bucket.refillPerMinute > 0 ? Math.ceil((missing / bucket.refillPerMinute) * 60) : 3600 };
}
