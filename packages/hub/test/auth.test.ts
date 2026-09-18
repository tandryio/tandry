import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { decodeResult, encodeCall } from "@tandryio/protocol";
import { startLocalHub, type HubUnderTest } from "../testing/start";

const OTP_SEND_PATH = "/api/auth/email-otp/send-verification-otp";

async function post(
  hub: HubUnderTest,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(hub.baseUrl + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: hub.baseUrl,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(((await response.json()) as { code: string }).code, code);
}

describe("website authentication over HTTP", () => {
  let hub: HubUnderTest;
  before(async () => {
    hub = await startLocalHub({ vars: { DEV_EMAIL_OTP: "console" } });
  });
  after(async () => {
    await hub?.stop();
  });

  test("a signed-out CLI can request a device code and poll without Origin or credentials", async () => {
    const start = encodeCall("login_start", {}, {});
    const response = await fetch(hub.baseUrl + start.path, start);
    const login = decodeResult("login_start", response.status, await response.json());
    assert.equal(new URL(login.url).origin, hub.baseUrl);
    assert.equal(new URL(login.url).searchParams.get("user_code"), login.userCode);
    assert.ok(login.deviceCode);
    assert.equal(response.headers.get("Cache-Control"), "no-store");

    const poll = encodeCall("login_status", {}, { deviceCode: login.deviceCode });
    const pending = await fetch(hub.baseUrl + poll.path, poll);
    assert.deepEqual(decodeResult("login_status", pending.status, await pending.json()), { state: "pending" });
  });

  test("CLI login does not exempt browser requests or other operations from origin checks", async () => {
    const rejectedHeaders: Record<string, string>[] = [
      { Origin: "https://other.example.test" },
      { Origin: "null" },
      { Cookie: "better-auth.session_token=synthetic-cookie" },
    ];
    for (const op of ["login_start", "login_status"] as const) {
      const request = encodeCall(op, {}, { deviceCode: "unknown-device" });
      for (const headers of rejectedHeaders) {
        const response = await fetch(hub.baseUrl + request.path, {
          ...request, headers: { ...request.headers, ...headers },
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { ok: false, error: { code: "forbidden", message: "Origin not allowed" } });
      }
    }
    for (const op of ["status", "logout"] as const) {
      const request = encodeCall(op, {}, {});
      const response = await fetch(hub.baseUrl + request.path, request);
      assert.equal(response.status, 403);
    }
  });

  test("config advertises enabled email login; ordinary auth requests still reach Better Auth", async () => {
    const config = await fetch(hub.baseUrl + "/api/config");
    assert.deepEqual(await config.json(), {
      navigation: [],
      providers: ["email"],
    });
    const session = await fetch(hub.baseUrl + "/api/auth/get-session");
    assert.equal(session.status, 200);
    assert.equal(await session.json(), null);
  });

  test("OTP permits only sign-in actions from the configured origin", async () => {
    const input = { email: "guard@example.test", type: "sign-in" };
    const unsupported = await post(
      hub,
      "/api/auth/email-otp/check-verification-otp",
      input,
    );
    assert.equal(unsupported.status, 404);
    for (const path of [OTP_SEND_PATH, "/api/auth/sign-in/email-otp"]) {
      const forbidden = await post(hub, path, input, {
        Origin: "https://other.example.test",
      });
      assert.equal(forbidden.status, 403);
      assert.deepEqual(await forbidden.json(), {
        message: "Origin not allowed",
      });
      const missingOrigin = await fetch(hub.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      assert.equal(missingOrigin.status, 403);
    }
    await expectError(
      await post(hub, OTP_SEND_PATH, { ...input, type: "forget-password" }),
      400,
      "EMAIL_INVALID",
    );
    await expectError(
      await post(hub, OTP_SEND_PATH, { ...input, email: "invalid" }),
      400,
      "EMAIL_INVALID",
    );
    const malformed = await fetch(hub.baseUrl + OTP_SEND_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: hub.baseUrl },
      body: "{",
    });
    await expectError(malformed, 400, "EMAIL_INVALID");
  });

  test("OTP limits normalize email case, count rejected attempts against the IP, and return Retry-After", async () => {
    const send = (email: string) =>
      post(hub, OTP_SEND_PATH, { email, type: "sign-in" });
    const first = await send("limit@example.test");
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { success: true });

    const repeated = await send("LIMIT@example.test");
    await expectError(repeated, 429, "OTP_RATE_LIMITED");
    assert.equal(repeated.headers.get("Retry-After"), "60");

    // The rejected second attempt still used one of the five IP attempts.
    for (let i = 0; i < 3; i++)
      assert.equal((await send(`limit-${i}@example.test`)).status, 200);
    await expectError(
      await send("over-ip-limit@example.test"),
      429,
      "OTP_RATE_LIMITED",
    );
  });

  test("profiles need authentication and handle writes reject foreign origins", async () => {
    await expectError(
      await fetch(hub.baseUrl + "/api/profile"),
      401,
      "UNAUTHORIZED",
    );
    await expectError(
      await post(hub, "/api/profile/handle", { handle: "somebody" }),
      401,
      "UNAUTHORIZED",
    );
    const forbidden = await post(
      hub,
      "/api/profile/handle",
      { handle: "somebody" },
      {
        Authorization: `Bearer ${hub.accounts.nohandle.token}`,
        Origin: "https://other.example.test",
      },
    );
    assert.equal(forbidden.status, 403);
  });

  test("handle claims normalize input, reject reserved/taken names, and cannot rename a claimed handle", async () => {
    const account = hub.accounts.nohandle;
    const headers = { Authorization: `Bearer ${account.token}` };
    const claim = (handle: unknown) =>
      post(hub, "/api/profile/handle", { handle }, headers);
    await expectError(await claim("admin"), 400, "HANDLE_INVALID");
    await expectError(await claim(42), 400, "HANDLE_INVALID");
    await expectError(await claim("bob"), 409, "HANDLE_UNAVAILABLE");

    const response = await claim(" @New_Name ");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      userId: account.id,
      handle: "new_name",
    });
    await expectError(await claim("another_name"), 409, "HANDLE_FIXED");

    const profile = await fetch(hub.baseUrl + "/api/profile", { headers });
    assert.equal(profile.status, 200);
    assert.equal(profile.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await profile.json(), {
      userId: account.id,
      handle: "new_name",
    });
  });

  test("invalid handle claims count toward the per-account limit", async () => {
    const headers = { Authorization: `Bearer ${hub.accounts.alice.token}` };
    for (let i = 0; i < 10; i++)
      await expectError(
        await post(hub, "/api/profile/handle", { handle: "!" }, headers),
        400,
        "HANDLE_INVALID",
      );
    await expectError(
      await post(hub, "/api/profile/handle", { handle: "!" }, headers),
      429,
      "RATE_LIMITED",
    );
    // A different account retains its own allowance.
    await expectError(
      await post(
        hub,
        "/api/profile/handle",
        { handle: "!" },
        {
          Authorization: `Bearer ${hub.accounts.bob.token}`,
        },
      ),
      400,
      "HANDLE_INVALID",
    );
  });
});

test("disabled email login is hidden from config and all OTP routes", async () => {
  const hub = await startLocalHub();
  try {
    const config = await fetch(hub.baseUrl + "/api/config");
    assert.deepEqual(await config.json(), { navigation: [], providers: [] });
    for (const path of [OTP_SEND_PATH, "/api/auth/sign-in/email-otp"])
      assert.equal(
        (
          await post(hub, path, {
            email: "disabled@example.test",
            type: "sign-in",
          })
        ).status,
        404,
      );
  } finally {
    await hub.stop();
  }
});

test("console OTP on a public tunnel requires an explicit matching development origin", async () => {
  const origin = "https://mcp.example.test";
  for (const allowedOrigin of [undefined, "https://other.example.test", origin]) {
    const hub = await startLocalHub({ vars: {
      BETTER_AUTH_URL: origin,
      DEV_EMAIL_OTP: "console",
      ...(allowedOrigin ? { DEV_EMAIL_OTP_ORIGIN: allowedOrigin } : {}),
    } });
    try {
      const enabled = allowedOrigin === origin;
      const config = await fetch(hub.baseUrl + "/api/config");
      assert.deepEqual(await config.json(), { navigation: [], providers: enabled ? ["email"] : [] });
      const sent = await post(hub, OTP_SEND_PATH, { email: "tunnel@example.test", type: "sign-in" }, { Origin: origin });
      assert.equal(sent.status, enabled ? 200 : 404);
      if (enabled) {
        assert.deepEqual(await sent.json(), { success: true });
        const denied = await post(hub, OTP_SEND_PATH, { email: "other@example.test", type: "sign-in" }, { Origin: "https://other.example.test" });
        assert.equal(denied.status, 403);
        const invalid = await post(hub, "/api/auth/sign-in/email-otp", { email: "tunnel@example.test", otp: "not-a-code" }, { Origin: origin });
        assert.notEqual(invalid.status, 200);
      }
    } finally {
      await hub.stop();
    }
  }
});
