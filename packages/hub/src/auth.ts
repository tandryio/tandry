import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization, emailOTP } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

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
}

export function emailEnabled(env: AuthConfig) {
  return !!(env.RESEND_API_KEY && env.RESEND_FROM);
}

/** Construct per request: D1 and request-scoped bindings must not escape the request. */
export function authFor(env: AuthConfig, onEmailDeliveryFailure?: () => void) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error("BETTER_AUTH_SECRET must be configured");
  const origin = new URL(env.BETTER_AUTH_URL);
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  )
    throw new Error("Authentication requires HTTPS");
  return betterAuth({
    appName: "Agent Room",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.AUTH_DB), {
      provider: "sqlite",
      schema,
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
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 120 },
    plugins: [
      bearer(),
      ...(emailEnabled(env)
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: 600,
              allowedAttempts: 5,
              storeOTP: "hashed",
              rateLimit: { window: 60, max: 5 },
              async sendVerificationOTP({ email, otp, type }, context) {
                if (type !== "sign-in")
                  throw new APIError("BAD_REQUEST", {
                    message: "仅支持登录验证码",
                  });
                try {
                  const chinese = /(?:^|;\s*)agent-room-locale=zh(?:;|$)/.test(
                    context?.request?.headers.get("Cookie") || "",
                  );
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
                        subject: chinese
                          ? "Agent Room 登录验证码"
                          : "Your Agent Room sign-in code",
                        text: chinese
                          ? `你的 Agent Room 登录验证码是：${otp}\n\n10 分钟内有效，请勿分享给他人。如果不是你本人操作，请忽略此邮件。`
                          : `Your Agent Room sign-in code is: ${otp}\n\nIt expires in 10 minutes. Do not share it with anyone. If you did not request this email, you can ignore it.`,
                      }),
                      signal: AbortSignal.timeout(10000),
                    },
                  );
                  if (!response.ok) throw new Error("Resend rejected email");
                  await response.body?.cancel();
                } catch {
                  onEmailDeliveryFailure?.();
                  // Never log the API key, recipient, OTP, or Resend response body.
                  throw new APIError("SERVICE_UNAVAILABLE", {
                    message: "验证码发送失败，请稍后重试",
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
        validateClient: (clientId) => clientId === "agent-room-cli",
      }),
    ],
  });
}
