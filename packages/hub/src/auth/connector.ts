import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { Handle } from "@tandryio/protocol";
import { APIError } from "better-auth/api";
import {
  createDpopReplayStore, createInsufficientScopeError, enforceDpopBinding, isDpopBindingError,
  parseAccessTokenAuthorization, verifyJwsAccessToken,
} from "better-auth/oauth2";
import type { Env } from "../env";
import { authFor, connectorResource } from "./auth";
import type { Principal } from "./principal";

type Claims = Awaited<ReturnType<typeof verifyJwsAccessToken>>;

const REQUIRED_SCOPES = ["tandry"];
/** Caches the signing keys for five minutes; a token with an unknown kid refetches them. */
const jwksCacheKey = {};

/**
 * The account behind a connector's OAuth access token, or the response that
 * refuses it: 401/403 with the RFC 9728 / RFC 6750 challenge a client needs to
 * start or step up authorization.
 */
export async function connectorPrincipal(env: Env, request: Request): Promise<Principal | Response> {
  const auth = authFor(env);
  const resource = connectorResource(env);
  let claims: Claims;
  try {
    claims = await verify(request, auth, resource);
  } catch (error) {
    const challenge = createResourceServerChallenge(error, resource, { challengeScopes: REQUIRED_SCOPES });
    if (!challenge) throw error;
    const headers = new Headers(challenge.headers);
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: challenge.message }, id: null }),
      { status: challenge.statusCode, headers });
  }
  if (typeof claims.sub !== "string") return new Response("Account required", { status: 403 });
  const account = await env.AUTH_DB.prepare("SELECT id, handle FROM user WHERE id=?").bind(claims.sub).first<{ id: string; handle: string | null }>();
  if (!account) return new Response("Account required", { status: 403 });
  const handle = Handle.safeParse(account.handle);
  return { accountId: account.id, handle: handle.success ? handle.data : null, via: "connector" };
}

/**
 * The checks of Better Auth's verifyAccessTokenRequest (signature, issuer,
 * audience, expiry, scope, DPoP binding), except that the keys come from this
 * Hub's own store. That function only fetches a JWKS URL, and ours is the
 * public origin, which in production routes back here through the website Worker.
 */
async function verify(request: Request, auth: ReturnType<typeof authFor>, resource: string): Promise<Claims> {
  const authorization = parseAccessTokenAuthorization(request.headers.get("authorization"));
  if (!authorization?.token) throw new APIError("UNAUTHORIZED", { message: "missing authorization header" });
  if (authorization.scheme === "Unknown")
    throw new APIError("UNAUTHORIZED", { message: "authorization scheme must be Bearer or DPoP", error: "invalid_token" });
  const { baseURL, internalAdapter } = await auth.$context;
  let claims: Claims;
  try {
    claims = await verifyJwsAccessToken(authorization.token, {
      jwksFetch: () => auth.api.getJwks(), jwksCacheKey, verifyOptions: { issuer: baseURL, audience: resource },
    });
  } catch (error) {
    // By code, not instanceof: jose may be installed more than once.
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_JWT_EXPIRED") throw new APIError("UNAUTHORIZED", { message: "token expired" });
    if ((typeof code === "string" && code.startsWith("ERR_J")) || error instanceof TypeError)
      throw new APIError("UNAUTHORIZED", { message: "invalid access token" });
    throw error;
  }
  const granted = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
  const missing = REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
  if (missing.length) throw createInsufficientScopeError(missing);
  try {
    await enforceDpopBinding({
      payload: claims, authorization, proofJwt: request.headers.get("dpop") ?? undefined, method: request.method, url: request.url,
      replayStore: createDpopReplayStore(internalAdapter),
    });
  } catch (error) {
    if (isDpopBindingError(error)) throw new APIError("UNAUTHORIZED", { message: error.message, error: error.code, error_description: error.message });
    throw error;
  }
  return claims;
}
