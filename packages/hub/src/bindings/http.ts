import { TandryError, fail, httpStatus, readContext, type Result } from "@tandryio/protocol";
import type { Context } from "hono";
import { principal } from "../auth/principal";
import type { Env } from "../env";
import { execute, type HubContext } from "../operations/execute";

/**
 * A browser mutation must come from our own origin; a bearer request needs
 * none. This is the CSRF rule for the cookie-authenticated website.
 */
export function originAllowed(env: Env, request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin) return origin === env.BETTER_AUTH_URL;
  return request.method === "GET" || !!request.headers.get("Authorization")?.startsWith("Bearer ");
}

/** POST /v1/:operation. Decodes, calls execute, encodes. Nothing else. */
export async function httpBinding(c: Context<{ Bindings: Env }>, hub: HubContext): Promise<Response> {
  let result: Result<unknown>;
  try {
    const op = c.req.param("operation") ?? "";
    // A signed-out CLI has neither Origin nor a token. Only device-code issuance
    // and polling allow this; requests carrying cookies still need the CSRF check.
    const cliLogin = (op === "login_start" || op === "login_status")
      && !c.req.raw.headers.has("Origin") && !c.req.raw.headers.has("Cookie");
    if (!cliLogin && !originAllowed(c.env, c.req.raw)) throw new TandryError("forbidden", "Origin not allowed");
    const context = readContext((name) => c.req.header(name));
    const input = await c.req.json().catch(() => { throw new TandryError("invalid_input", "The request body is not JSON"); });
    result = await execute(hub, { op, principal: await principal(c.env, c.req.raw), ...context, input });
  } catch (error) {
    if (!(error instanceof TandryError)) throw error;
    result = fail(error.code, error.message, error.data);
  }
  c.header("Cache-Control", "no-store");
  return c.json(result, httpStatus(result) as 200);
}
