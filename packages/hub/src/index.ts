import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { handlesFor, normalizeHandle } from "./handles";
import { authFor, emailEnabled } from "./auth";
import type { Env } from "./room";
export { TeamRoom } from "./room";

type Identity = {
  userId: string;
  name: string;
  handle: string | null;
  sessionId: string;
};
const app = new Hono<{ Bindings: Env; Variables: { identity: Identity } }>();
app.use("*", bodyLimit({ maxSize: 128 * 1024 }));
app.onError((error, c) => {
  console.error(
    JSON.stringify({
      event: "request_failed",
      path: c.req.path,
      error: error.name,
    }),
  );
  return c.json({ error: "Service temporarily unavailable" }, 503);
});
app.get("/health", (c) => c.json({ ok: true, now: Date.now() }));
app.get("/api/config", (c) =>
  c.json({
    providers: [
      ...(emailEnabled(c.env) ? ["email"] : []),
      ...(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET
        ? ["github"]
        : []),
      ...(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET
        ? ["google"]
        : []),
    ],
  }),
);
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  if (c.req.path.includes("email-otp")) {
    const send = c.req.path === "/api/auth/email-otp/send-verification-otp";
    if (
      !emailEnabled(c.env) ||
      (!send && c.req.path !== "/api/auth/sign-in/email-otp")
    )
      return c.json({ message: "Not found" }, 404);
    if (c.req.header("Origin") !== c.env.BETTER_AUTH_URL)
      return c.json({ message: "Origin not allowed" }, 403);
    if (send) {
      const body = await c.req.raw
        .clone()
        .json()
        .catch(() => null);
      const parsed = z
        .object({ email: z.email().max(254), type: z.literal("sign-in") })
        .safeParse(body);
      if (!parsed.success) return c.json({ message: "请输入有效邮箱" }, 400);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(parsed.data.email.toLowerCase()),
      );
      const emailKey = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const ip = c.req.header("CF-Connecting-IP") || "local";
      if (
        !(await allow(c.env, `otp-ip:${ip}`, 5, 60_000)) ||
        !(await allow(c.env, `otp-minute:${emailKey}`, 1, 60_000)) ||
        !(await allow(c.env, `otp-day:${emailKey}`, 10, 86_400_000)) ||
        !(await allow(c.env, "otp-global-day", 1000, 86_400_000))
      ) {
        c.header("Retry-After", "60");
        return c.json({ message: "验证码请求过于频繁，请稍后再试" }, 429);
      }
    }
  }
  // Better Auth awaits email delivery but catches callback exceptions. Preserve a
  // request-local failure flag so the UI never claims a rejected send succeeded.
  let emailDeliveryFailed = false;
  const response = await authFor(c.env, () => {
    emailDeliveryFailed = true;
  }).handler(c.req.raw);
  if (!response.ok && c.req.path === "/api/auth/sign-in/email-otp") {
    const error = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: unknown } | null;
    console.warn(
      JSON.stringify({
        event: "email_sign_in_failed",
        status: response.status,
        code: typeof error?.code === "string" ? error.code : "UNKNOWN",
      }),
    );
  }
  if (emailDeliveryFailed)
    return c.json({ message: "验证码发送失败，请稍后重试" }, 503);
  return response;
});
app.use("*", async (c, next) => {
  // Browser mutations require our exact origin. CLI bearer requests need no browser origin.
  const origin = c.req.header("Origin");
  if (origin && origin !== c.env.BETTER_AUTH_URL)
    return c.json({ error: "Origin not allowed" }, 403);
  if (
    !["GET", "HEAD"].includes(c.req.method) &&
    !origin &&
    !c.req.header("Authorization")?.startsWith("Bearer ")
  ) {
    return c.json({ error: "Origin or bearer authentication required" }, 403);
  }
  const session = await authFor(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session)
    return c.json(
      { error: "Sign in to Agent Room first", code: "UNAUTHORIZED" },
      401,
    );
  const identity: Identity = {
    userId: session.user.id,
    name: session.user.name,
    handle: (session.user as { handle?: string | null }).handle ?? null,
    sessionId: session.session.id,
  };
  c.set("identity", identity);
  // The only setup gate: identity is proven, but rooms need a public handle.
  if (!identity.handle && !PROFILE_PATHS.has(c.req.path))
    return c.json(
      { error: "Choose your @handle to continue", code: "HANDLE_REQUIRED" },
      403,
    );
  await next();
});
const PROFILE_PATHS = new Set(["/api/me", "/api/profile", "/api/profile/handle"]);
app.get("/api/me", (c) => c.json(c.get("identity")));
app.get("/api/profile", (c) => {
  const { userId, name, handle } = c.get("identity");
  c.header("Cache-Control", "no-store");
  return c.json({ userId, name, handle });
});
app.post("/api/profile/handle", async (c) => {
  const identity = c.get("identity");
  if (!(await allow(c.env, `handle:${identity.userId}`, 10, 60_000)))
    return c.json({ error: "Too many attempts", code: "RATE_LIMITED" }, 429);
  const body = await c.req.json().catch(() => null);
  const handle = normalizeHandle((body as { handle?: unknown } | null)?.handle);
  if (!handle)
    return c.json(
      {
        error:
          "Use 3–24 letters, numbers, or underscores, starting with a letter. Reserved names are not allowed.",
        code: "HANDLE_INVALID",
      },
      400,
    );
  // One conditional UPDATE: the row's NULL check and the UNIQUE index make the
  // claim atomic, so no pre-check and no race between check and write.
  let result: D1Result;
  try {
    result = await c.env.AUTH_DB.prepare(
      "UPDATE user SET handle=?, name=CASE WHEN name='' THEN ? ELSE name END, updatedAt=? WHERE id=? AND handle IS NULL",
    )
      .bind(handle, handle, Date.now(), identity.userId)
      .run();
  } catch (error) {
    if (!/UNIQUE/i.test((error as Error).message)) throw error;
    return c.json(
      { error: "This handle is already taken", code: "HANDLE_UNAVAILABLE" },
      409,
    );
  }
  if (!result.meta.changes)
    return c.json(
      { error: "Your handle is already set", code: "HANDLE_FIXED" },
      409,
    );
  c.header("Cache-Control", "no-store");
  return c.json({ userId: identity.userId, handle });
});
app.get("/api/users/:handle", async (c) => {
  if (!(await allow(c.env, `lookup:${c.get("identity").userId}`, 60, 60_000)))
    return c.json({ error: "Too many lookups" }, 429);
  const handle = normalizeHandle(c.req.param("handle"));
  if (!handle) return c.json({ error: "User not found" }, 404);
  const user = await c.env.AUTH_DB.prepare(
    "SELECT id AS userId,handle,name FROM user WHERE handle=?",
  )
    .bind(handle)
    .first();
  c.header("Cache-Control", "no-store");
  return user ? c.json(user) : c.json({ error: "User not found" }, 404);
});

function roomStub(env: Env, code: string) {
  return env.TEAM_ROOM.get(env.TEAM_ROOM.idFromName(code));
}
function internalRequest(
  path: string,
  identity: Identity,
  method = "GET",
  body?: unknown,
) {
  return new Request(`https://room${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-ar-user": identity.userId,
      "x-ar-name": encodeURIComponent(identity.name),
      "x-ar-session": identity.sessionId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function remember(env: Env, identity: Identity, response: Response) {
  if (response.ok) {
    const info = await response
      .clone()
      .json<{ code: string; name: string; createdAt: number }>();
    await env.AUTH_DB.prepare(
      "INSERT OR REPLACE INTO roomDirectory (code,userId,name,createdAt) VALUES (?,?,?,?)",
    )
      .bind(info.code, identity.userId, info.name, info.createdAt)
      .run();
  }
  return response;
}
async function allow(env: Env, key: string, max: number, periodMs: number) {
  const now = Date.now();
  const row = await env.AUTH_DB.prepare(
    `INSERT INTO usageWindow (key,count,resetsAt) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN resetsAt <= ? THEN 1 ELSE count+1 END,
    resetsAt = CASE WHEN resetsAt <= ? THEN ? ELSE resetsAt END RETURNING count`,
  )
    .bind(key, now + periodMs, now, now, now + periodMs)
    .first<{ count: number }>();
  return !!row && row.count <= max;
}
app.post("/rooms", async (c) => {
  const identity = c.get("identity");
  const parsed = z
    .object({ name: z.string().max(100).default("") })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(
      { error: "Supply a room name of at most 100 characters" },
      400,
    );
  if (!(await allow(c.env, `create:${identity.userId}`, 10, 86_400_000)))
    return c.json({ error: "Daily room creation limit reached" }, 429);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newRoomCode();
    const response = await roomStub(c.env, code).fetch(
      internalRequest("/init", identity, "POST", {
        code,
        name: parsed.data.name,
        idleDays: idleDays(c.env),
      }),
    );
    if (response.status !== 409) return remember(c.env, identity, response);
  }
  return c.json({ error: "Could not allocate a room code; retry" }, 503);
});
app.get("/api/rooms", async (c) => {
  const identity = c.get("identity");
  const rows = await c.env.AUTH_DB.prepare(
    "SELECT code FROM roomDirectory WHERE userId = ? ORDER BY createdAt DESC LIMIT 100",
  )
    .bind(identity.userId)
    .all<{ code: string }>();
  const rooms = await Promise.all(
    rows.results.map(async (row) => {
      const response = await roomStub(c.env, row.code).fetch(
        internalRequest("/info", identity),
      );
      if (!response.ok) return null;
      return response.json();
    }),
  );
  return c.json({ rooms: rooms.filter(Boolean) });
});
app.post("/rooms/:code/join", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "Invalid room code" }, 400);
  const identity = c.get("identity");
  if (!(await allow(c.env, `join:${identity.userId}`, 30, 60_000)))
    return c.json({ error: "Too many join attempts" }, 429);
  return remember(
    c.env,
    identity,
    await roomStub(c.env, code).fetch(
      internalRequest("/join", identity, "POST"),
    ),
  );
});
app.get("/rooms/:code", (c) => {
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "Invalid room code" }, 400);
  return roomStub(c.env, code).fetch(
    internalRequest("/info", c.get("identity")),
  );
});
app.on(["GET", "POST"], "/rooms/:code/members", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  if (!code) return c.json({ error: "Invalid room code" }, 400);
  const body =
    c.req.method === "POST" ? await c.req.json().catch(() => null) : undefined;
  const response = await roomStub(c.env, code).fetch(
    internalRequest("/members", c.get("identity"), c.req.method, body),
  );
  if (!response.ok) return response;
  const data = await response.json<{
    ownerId: string;
    members: { userId: string; name: string }[];
  }>();
  const handles = await handlesFor(
    c.env.AUTH_DB,
    data.members.map((m) => m.userId),
  );
  return c.json({
    ...data,
    members: data.members.map((m) => ({
      ...m,
      handle: handles.get(m.userId) ?? null,
    })),
  });
});
app.get("/ws", (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket")
    return c.text("expected websocket upgrade", 426);
  const code = normalizeCode(c.req.query("room") ?? "");
  if (!code) return c.text("bad room code", 400);
  const identity = c.get("identity");
  const headers = new Headers(c.req.raw.headers);
  // Never forward client-supplied identity assertions.
  headers.set("x-ar-user", identity.userId);
  headers.set("x-ar-name", encodeURIComponent(identity.name));
  headers.set("x-ar-session", identity.sessionId);
  return roomStub(c.env, code).fetch(new Request(c.req.raw, { headers }));
});
// Browser API shares the same room handlers as plugins, with no second authorization path.
app.all("/api/rooms/*", (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.slice(4);
  return app.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
});
app.post("/api/rooms", (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/rooms";
  return app.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
});
export default app;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newRoomCode() {
  // Rejection sampling avoids modulo bias.
  let chars = "";
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < 8) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]!;
    if (byte < limit) chars += ALPHABET[byte % ALPHABET.length];
  }
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
export function normalizeCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 8 && [...s].every((ch) => ALPHABET.includes(ch))
    ? `${s.slice(0, 4)}-${s.slice(4)}`
    : null;
}
function idleDays(env: Env) {
  const n = Number(env.ROOM_IDLE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 7;
}
