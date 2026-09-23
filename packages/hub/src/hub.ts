import { LINK_PATH } from "@tandryio/protocol";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { authRoutes } from "./auth/routes";
import { avatarRoutes } from "./avatars/routes";
import { httpBinding } from "./bindings/http";
import { linkBinding } from "./bindings/link";
import { mcpBinding } from "./bindings/mcp";
import { directory } from "./directory/directory";
import type { Env } from "./env";
import type { HubContext } from "./operations/execute";
import type { PolicyFactory } from "./policy/policy";

export type HubApp<E extends Env = Env> = Hono<{ Bindings: E }>;

export interface HubOptions<E extends Env = Env> {
  policy: PolicyFactory<E>;
  /** Extra routes composed in by a deployment, e.g. billing. They never reach into the Hub. */
  routes?: ((app: HubApp<E>) => void)[];
  /** Extra website navigation entries, served from /api/config. */
  navigation?: { href: string; label: { en: string; zh: string } }[];
}

/** The whole Hub as one Worker app. Stateless: rooms live in RoomDO, accounts in D1. */
export function createHub<E extends Env = Env>(options: HubOptions<E>) {
  const app = new Hono<{ Bindings: E }>();
  const hub = (env: E): HubContext => ({ env, policy: options.policy(env), directory: directory(env.AUTH_DB), now: Date.now });

  app.use("*", bodyLimit({ maxSize: 256 * 1024 }));
  app.onError((error, c) => {
    console.error(JSON.stringify({ event: "request_failed", path: c.req.path, error: error.name, message: error.message }));
    return c.json({ ok: false, error: { code: "unavailable", message: "Service temporarily unavailable" } }, 503);
  });
  app.get("/health", (c) => c.json({ ok: true, now: Date.now() }));

  authRoutes(app as unknown as HubApp, options.navigation ?? []);
  avatarRoutes(app as unknown as HubApp);
  for (const configure of options.routes ?? []) configure(app);

  app.get(LINK_PATH, (c) => linkBinding(c as never));
  app.use("/mcp", cors({ origin: "*", exposeHeaders: ["WWW-Authenticate"], allowHeaders: ["Authorization", "Content-Type", "MCP-Protocol-Version", "Mcp-Method", "Mcp-Name", "DPoP"], allowMethods: ["POST", "OPTIONS"] }));
  app.post("/mcp", (c) => mcpBinding(c.req.raw, hub(c.env)));
  app.on(["GET", "DELETE"], "/mcp", (c) => c.body(null, 405, { Allow: "POST, OPTIONS" }));
  app.post("/v1/:operation", (c) => httpBinding(c as never, hub(c.env)));
  return app;
}
