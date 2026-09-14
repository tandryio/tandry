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
  "agentroom",
  "agent_room",
  "aroom",
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
export async function handlesFor(db: D1Database, ids: string[]) {
  const unique = [...new Set(ids)].filter(Boolean);
  const result = new Map<string, string>();
  // D1 parameter budget: room connection limit is 100, batch below that.
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const rows = await db
      .prepare(
        `SELECT id AS userId,handle FROM user WHERE id IN (${batch.map(() => "?").join(",")})`,
      )
      .bind(...batch)
      .all<{ userId: string; handle: string | null }>();
    for (const row of rows.results)
      if (row.handle) result.set(row.userId, row.handle);
  }
  return result;
}
