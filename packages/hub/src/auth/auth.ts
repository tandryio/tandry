import emailMessages from "./messages/email.json";
import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization, emailOTP, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import * as oauthSchema from "./oauth-schema";

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * MINUTE_SECONDS;
const SESSION_LIFETIME_SECONDS = 30 * DAY_SECONDS;
const OTP_LIFETIME_SECONDS = 10 * MINUTE_SECONDS;
const EMAIL_DELIVERY_TIMEOUT_MS = 10_000;
const MIN_SECRET_LENGTH = 32;

export interface AuthConfig extends Pick<
  Cloudflare.Env,
  "AUTH_DB" | "BETTER_AUTH_URL"
> {
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  DEV_EMAIL_OTP?: string;
  /** Explicit public origin for console OTP during local tunnel development. */
  DEV_EMAIL_OTP_ORIGIN?: string;
}

export function consoleEmailEnabled(
  env: Pick<AuthConfig, "DEV_EMAIL_OTP" | "DEV_EMAIL_OTP_ORIGIN" | "BETTER_AUTH_URL">,
) {
  if (env.DEV_EMAIL_OTP !== "console") return false;
  const origin = new URL(env.BETTER_AUTH_URL);
  if (origin.protocol === "https:" && env.DEV_EMAIL_OTP_ORIGIN === origin.origin
    && env.BETTER_AUTH_URL === origin.origin) return true;
  return (
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  );
}

export function emailEnabled(env: AuthConfig) {
  return consoleEmailEnabled(env) || !!(env.RESEND_API_KEY && env.RESEND_FROM);
}

/** Construct per request: D1 and request-scoped bindings must not escape the request. */
export function authFor(env: AuthConfig, onEmailDeliveryFailure?: () => void) {
  if (
    !env.BETTER_AUTH_SECRET ||
    env.BETTER_AUTH_SECRET.length < MIN_SECRET_LENGTH
  )
    throw new Error("BETTER_AUTH_SECRET must be configured");
  const origin = new URL(env.BETTER_AUTH_URL);
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  )
    throw new Error("Authentication requires HTTPS");
  return betterAuth({
    appName: "Tandry",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.AUTH_DB), {
      provider: "sqlite",
      schema: { ...schema, ...oauthSchema },
      transaction: false,
    }),
    // Identity providers only prove who the user is. The handle is claimed
    // afterwards through POST /api/profile/handle; it is readable on the session
    // but never writable through Better Auth's generic profile update.
    user: {
      additionalFields: {
        handle: { type: "string", required: false, input: false },
      },
    },
    trustedOrigins: [env.BETTER_AUTH_URL],
    disabledPaths: ["/token"],
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              prompt: "select_account" as const,
            },
          }
        : {}),
    },
    // Link another provider explicitly from an authenticated account; never merge by display name/email alone.
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
      },
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: DAY_SECONDS,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: MINUTE_SECONDS,
      max: 120,
    },
    plugins: [
      bearer(),
      jwt(),
      mcp({
        loginPage: "/connect",
        consentPage: "/connect",
        resource: `${env.BETTER_AUTH_URL}/mcp`,
        scopes: ["tandry", "offline_access"],
        accessTokenExpiresIn: 15 * MINUTE_SECONDS,
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      ...(emailEnabled(env)
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: OTP_LIFETIME_SECONDS,
              allowedAttempts: 5,
              storeOTP: "hashed",
              rateLimit: { window: MINUTE_SECONDS, max: 5 },
              async sendVerificationOTP({ email, otp, type }, context) {
                if (type !== "sign-in")
                  throw new APIError("BAD_REQUEST", {
                    message: "Only sign-in codes are supported",
                    code: "OTP_TYPE_UNSUPPORTED",
                  });
                // Explicit local development only; keep normal OTP verification and limits.
                if (consoleEmailEnabled(env)) {
                  console.log(
                    `[dev email OTP] ${email}: ${otp} (expires in 10 minutes)`,
                  );
                  return;
                }
                try {
                  const chinese = /(?:^|;\s*)tandry-locale=zh(?:;|$)/.test(
                    context?.request?.headers.get("Cookie") || "",
                  );
                  const message = emailMessages[chinese ? "zh" : "en"];
                  const response = await fetch(
                    "https://api.resend.com/emails",
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${env.RESEND_API_KEY}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        from: env.RESEND_FROM,
                        to: [email],
                        subject: message.subject,
                        text: message.text.replace("{otp}", otp),
                      }),
                      signal: AbortSignal.timeout(EMAIL_DELIVERY_TIMEOUT_MS),
                    },
                  );
                  if (!response.ok) throw new Error("Resend rejected email");
                  await response.body?.cancel();
                } catch {
                  onEmailDeliveryFailure?.();
                  // Never log the API key, recipient, OTP, or Resend response body.
                  throw new APIError("SERVICE_UNAVAILABLE", {
                    message: "Could not send the code; try again later",
                    code: "OTP_SEND_FAILED",
                  });
                }
              },
            }),
          ]
        : []),
      deviceAuthorization({
        verificationUri: `${env.BETTER_AUTH_URL}/device`,
        expiresIn: "10m",
        interval: "5s",
        validateClient: (clientId) => clientId === "tandry-cli",
      }),
    ],
  });
}
