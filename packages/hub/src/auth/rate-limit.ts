const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface RateLimit {
  max: number;
  windowMs: number;
}

const OTP_LIMITS = {
  perIpMinute: { max: 5, windowMs: MINUTE_MS },
  perEmailMinute: { max: 1, windowMs: MINUTE_MS },
  perEmailDay: { max: 10, windowMs: DAY_MS },
  globalDay: { max: 1000, windowMs: DAY_MS },
} satisfies Record<string, RateLimit>;
const HANDLE_CLAIM_LIMIT: RateLimit = { max: 10, windowMs: MINUTE_MS };
const AVATAR_UPLOAD_LIMIT: RateLimit = { max: 10, windowMs: MINUTE_MS };
export const OTP_RETRY_AFTER_SECONDS = 60;

/** Fixed-window counter in D1. Used only for sign-in abuse, never for messages. */
async function allow(
  db: D1Database,
  key: string,
  limit: RateLimit,
): Promise<boolean> {
  const now = Date.now();
  const resetsAt = now + limit.windowMs;
  const row = await db
    .prepare(
      `INSERT INTO usageWindow (key,count,resetsAt) VALUES (?,1,?)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN resetsAt <= ? THEN 1 ELSE count+1 END,
     resetsAt = CASE WHEN resetsAt <= ? THEN ? ELSE resetsAt END RETURNING count`,
    )
    .bind(key, resetsAt, now, now, resetsAt)
    .first<{ count: number }>();
  return !!row && row.count <= limit.max;
}

export async function allowOtpSend(
  db: D1Database,
  email: string,
  ip: string,
): Promise<boolean> {
  // Keep the recipient out of the rate-limit keys stored in D1.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.toLowerCase()),
  );
  const emailKey = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const checks: [string, RateLimit][] = [
    [`otp-ip:${ip}`, OTP_LIMITS.perIpMinute],
    [`otp-minute:${emailKey}`, OTP_LIMITS.perEmailMinute],
    [`otp-day:${emailKey}`, OTP_LIMITS.perEmailDay],
    ["otp-global-day", OTP_LIMITS.globalDay],
  ];
  // Preserve the charging order: once rejected, later counters are untouched.
  for (const [key, limit] of checks) {
    if (!(await allow(db, key, limit))) return false;
  }
  return true;
}

export function allowHandleClaim(
  db: D1Database,
  accountId: string,
): Promise<boolean> {
  return allow(db, `handle:${accountId}`, HANDLE_CLAIM_LIMIT);
}

export function allowAvatarUpload(
  db: D1Database,
  accountId: string,
): Promise<boolean> {
  return allow(db, `avatar:${accountId}`, AVATAR_UPLOAD_LIMIT);
}
