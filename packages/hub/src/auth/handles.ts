/** Handles are public identifiers, never credentials. Claimed handles cannot be renamed. */
const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "api",
  "auth",
  "login",
  "logout",
  "account",
  "settings",
  "security",
  "official",
  "tandry",
  "tandryio",
  "everyone",
  "here",
  "all",
]);
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z][a-z0-9_]{2,23}$/.test(handle) && !RESERVED.has(handle)
    ? handle
    : null;
}

/** One conditional UPDATE: the NULL check and UNIQUE index make the claim atomic. */
export async function claimHandle(
  db: D1Database,
  accountId: string,
  handle: string,
): Promise<"claimed" | "taken" | "fixed"> {
  let result: D1Result;
  try {
    result = await db
      .prepare(
        `
      UPDATE user SET handle=?, name=CASE WHEN name='' THEN ? ELSE name END, updatedAt=?
      WHERE id=? AND handle IS NULL
    `,
      )
      .bind(handle, handle, Date.now(), accountId)
      .run();
  } catch (error) {
    if (!/UNIQUE/i.test((error as Error).message)) throw error;
    return "taken";
  }
  return result.meta.changes ? "claimed" : "fixed";
}
