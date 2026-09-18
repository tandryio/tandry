import type { Context } from "hono";
import { z } from "zod";
import type { HubApp } from "../hub";
import type { Env } from "../env";
import { originAllowed } from "../bindings/http";
import { authFor, emailEnabled } from "./auth";
import { claimHandle, normalizeHandle } from "./handles";
import { principal } from "./principal";
import {
  allowHandleClaim,
  allowOtpSend,
  OTP_RETRY_AFTER_SECONDS,
} from "./rate-limit";

type AuthContext = Context<{ Bindings: Env }>;

const OTP_SEND_PATH = "/api/auth/email-otp/send-verification-otp";
const OTP_SIGN_IN_PATH = "/api/auth/sign-in/email-otp";
const MAX_EMAIL_LENGTH = 254;
const otpSendInput = z.object({
  email: z.email().max(MAX_EMAIL_LENGTH),
  type: z.literal("sign-in"),
});

/** Reject unsupported OTP actions before handing the request to Better Auth. */
async function validateEmailOtp(c: AuthContext): Promise<Response | undefined> {
  const path = c.req.path;
  if (!path.includes("email-otp")) return;
  if (!emailEnabled(c.env)) return c.json({ message: "Not found" }, 404);
  if (path !== OTP_SEND_PATH && path !== OTP_SIGN_IN_PATH)
    return c.json({ message: "Not found" }, 404);
  if (c.req.header("Origin") !== c.env.BETTER_AUTH_URL)
    return c.json({ message: "Origin not allowed" }, 403);
  if (path !== OTP_SEND_PATH) return;

  // Better Auth still needs to read the original request body.
  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  const parsed = otpSendInput.safeParse(body);
  if (!parsed.success)
    return c.json(
      { message: "Enter a valid email address", code: "EMAIL_INVALID" },
      400,
    );

  const ip = c.req.header("CF-Connecting-IP") || "local";
  if (!(await allowOtpSend(c.env.AUTH_DB, parsed.data.email, ip))) {
    c.header("Retry-After", String(OTP_RETRY_AFTER_SECONDS));
    return c.json(
      {
        message: "Too many code requests; try again later",
        code: "OTP_RATE_LIMITED",
      },
      429,
    );
  }
}

async function handleAuth(c: AuthContext): Promise<Response> {
  const rejection = await validateEmailOtp(c);
  if (rejection) return rejection;

  // Better Auth awaits email delivery but swallows callback exceptions. Keep a
  // request-local flag so the UI never claims a rejected send succeeded.
  let emailDeliveryFailed = false;
  const response = await authFor(c.env, () => {
    emailDeliveryFailed = true;
  }).handler(c.req.raw);
  if (emailDeliveryFailed)
    return c.json(
      {
        message: "Could not send the code; try again later",
        code: "OTP_SEND_FAILED",
      },
      503,
    );
  return response;
}

async function getProfile(c: AuthContext): Promise<Response> {
  const who = await principal(c.env, c.req.raw);
  if (!who)
    return c.json(
      { error: "Sign in to Tandry first", code: "UNAUTHORIZED" },
      401,
    );
  c.header("Cache-Control", "no-store");
  return c.json({ userId: who.accountId, handle: who.handle });
}

async function handleClaim(c: AuthContext): Promise<Response> {
  const who = await principal(c.env, c.req.raw);
  if (!who)
    return c.json(
      { error: "Sign in to Tandry first", code: "UNAUTHORIZED" },
      401,
    );
  if (!(await allowHandleClaim(c.env.AUTH_DB, who.accountId)))
    return c.json({ error: "Too many attempts", code: "RATE_LIMITED" }, 429);

  const body = await c.req
    .json<{ handle?: unknown } | null>()
    .catch(() => null);
  const handle = normalizeHandle(body?.handle);
  if (!handle)
    return c.json(
      {
        error:
          "Use 3–24 letters, numbers, or underscores, starting with a letter. Reserved names are not allowed.",
        code: "HANDLE_INVALID",
      },
      400,
    );

  const outcome = await claimHandle(c.env.AUTH_DB, who.accountId, handle);
  if (outcome === "taken")
    return c.json(
      { error: "This handle is already taken", code: "HANDLE_UNAVAILABLE" },
      409,
    );
  if (outcome === "fixed")
    return c.json(
      { error: "Your handle is already set", code: "HANDLE_FIXED" },
      409,
    );
  c.header("Cache-Control", "no-store");
  return c.json({ userId: who.accountId, handle });
}

/**
 * What the website needs besides operations: Better Auth's own endpoints, the
 * sign-in configuration, and claiming a handle. A handle is claimed once and
 * never renamed, which is what lets rooms keep a copy of it on each member.
 */
export function authRoutes(
  app: HubApp,
  navigation: { href: string; label: { en: string; zh: string } }[],
) {
  app.get("/api/config", (c) =>
    c.json({
      navigation,
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
  app.on(["GET", "POST"], "/api/auth/*", handleAuth);
  app.on(["GET", "HEAD"], "/.well-known/*", handleAuth);
  app.use("/api/profile/*", async (c, next) =>
    originAllowed(c.env, c.req.raw)
      ? next()
      : c.json({ error: "Origin not allowed" }, 403),
  );
  app.get("/api/profile", getProfile);
  app.post("/api/profile/handle", handleClaim);
}
