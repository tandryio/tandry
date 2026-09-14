import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readCredentials } from "./config";
import { httpRequest } from "./net";

type Login = { token: string; userId: string; name: string; expiresAt: number };
type Device = {
  device_code: string;
  user_code: string;
  verification_uri_complete?: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};
const pending = new Map<
  string,
  { device: Device; deadline: number; promise: Promise<void>; error?: string }
>();
function origin() {
  const url = new URL(readCredentials().hub.replace(/^ws/, "http"));
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Agent Room login requires HTTPS");
  return url.origin;
}
function file() {
  const dir =
    process.env.AGENT_ROOM_AUTH_HOME ??
    process.env.AGENT_ROOM_HOME ??
    path.join(os.homedir(), ".agent-room");
  return path.join(
    dir,
    "auth",
    createHash("sha256").update(origin()).digest("hex") + ".json",
  );
}
export function readLogin(): Login | null {
  try {
    const value = JSON.parse(fs.readFileSync(file(), "utf8")) as Login;
    return typeof value.token === "string" &&
      typeof value.userId === "string" &&
      value.expiresAt > Date.now()
      ? value
      : null;
  } catch {
    return null;
  }
}
function saveLogin(value: Login) {
  const destination = file();
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const tmp = `${destination}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(tmp, destination);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* renamed */
    }
  }
}
export function authHeaders(): Record<string, string> {
  const login = readLogin();
  return login ? { Authorization: `Bearer ${login.token}` } : {};
}
export function accountScope() {
  return readLogin()?.userId ?? "signed-out";
}
type Me = { userId: string; name: string; handle: string | null };
export function loginStatus(me?: Me) {
  const login = readLogin();
  const attempt = pending.get(origin());
  return {
    loggedIn: !!login,
    user: login ? { id: login.userId, name: login.name } : null,
    pending: !!attempt && !attempt.error && attempt.deadline > Date.now(),
    error: attempt?.error ?? null,
    // Rooms stay closed until the account has chosen its public @handle.
    ...(me && !me.handle
      ? {
          handleRequired: true,
          instruction: `Ask the user to choose their @handle at ${origin()}/account, then check status again.`,
        }
      : {}),
  };
}
async function post(
  route: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return httpRequest(`${origin()}/api/auth/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "agent-room/1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
export async function login(action: "start" | "status" | "logout" = "start") {
  const hub = origin();
  let me: Me | undefined;
  if (action !== "logout" && readLogin()) {
    const response = await httpRequest(`${hub}/api/me`, {
      headers: authHeaders(),
    });
    if (response.status === 401) {
      try {
        fs.unlinkSync(file());
      } catch {
        /* removed elsewhere */
      }
    } else if (response.status !== 200)
      throw new Error(
        "Could not verify login; retry when the service is available",
      );
    else me = response.json<Me>();
  }
  if (action === "status") return loginStatus(me);
  if (action === "logout") {
    pending.delete(hub);
    if (readLogin()) {
      const response = await post("sign-out", {}, authHeaders());
      if (response.status >= 400 && response.status !== 401)
        throw new Error("Could not revoke login; retry when connected");
    }
    try {
      fs.unlinkSync(file());
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return loginStatus();
  }
  if (readLogin()) return loginStatus(me);
  const existing = pending.get(hub);
  if (existing && !existing.error && existing.deadline > Date.now())
    return prompt(existing.device);
  const response = await post("device/code", { client_id: "agent-room-cli" });
  if (response.status !== 200)
    throw new Error(`Login unavailable (${response.status})`);
  const device = response.json<Device>();
  if (
    !device.device_code ||
    !device.user_code ||
    !device.verification_uri ||
    !Number.isFinite(device.expires_in)
  )
    throw new Error("Invalid device authorization response");
  const attempt = {
    device,
    deadline: Date.now() + device.expires_in * 1000,
    promise: Promise.resolve(),
    error: undefined as string | undefined,
  };
  pending.set(hub, attempt);
  attempt.promise = (async () => {
    let interval = Math.max(5, device.interval || 5);
    while (pending.get(hub) === attempt && Date.now() < attempt.deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval * 1000);
        timer.unref();
      });
      if (pending.get(hub) !== attempt || origin() !== hub) return;
      let result;
      try {
        result = await post("device/token", {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: device.device_code,
          client_id: "agent-room-cli",
        });
      } catch {
        continue;
      }
      const data = result.json<{
        access_token?: string;
        expires_in?: number;
        error?: string;
      }>();
      if (pending.get(hub) !== attempt) return;
      if (result.status === 200 && data.access_token) {
        const me = await httpRequest(`${hub}/api/me`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        if (me.status !== 200)
          throw new Error("Could not verify authorized account");
        const user = me.json<{ userId: string; name: string }>();
        if (pending.get(hub) !== attempt) return;
        saveLogin({
          token: data.access_token,
          userId: user.userId,
          name: user.name,
          expiresAt:
            Date.now() + Math.min(data.expires_in ?? 86400, 30 * 86400) * 1000,
        });
        pending.delete(hub);
        return;
      }
      if (data.error === "slow_down") interval += 5;
      else if (data.error !== "authorization_pending" && result.status !== 429)
        throw new Error(data.error ?? "Device authorization failed");
    }
    if (pending.get(hub) === attempt)
      attempt.error = "Authorization expired; start login again";
  })().catch((error: Error) => {
    attempt.error = error.message;
  });
  return prompt(device);
}
function prompt(device: Device) {
  return {
    loggedIn: false,
    pending: true,
    userCode: device.user_code,
    verificationUrl:
      device.verification_uri_complete ?? device.verification_uri,
    instruction:
      "Open this URL yourself, sign in with an available method, compare the displayed code, and explicitly approve your device. Login completes automatically; do not share tokens.",
  };
}
export async function runLogin(action: string = "start") {
  if (!["start", "status", "logout"].includes(action))
    throw new Error("usage: agent-room login [start|status|logout]");
  console.log(
    JSON.stringify(
      await login(action as "start" | "status" | "logout"),
      null,
      2,
    ),
  );
  if (action === "start" && pending.has(origin())) {
    const keepAlive = setInterval(() => {}, 1000);
    try {
      await pending.get(origin())!.promise;
      console.log(JSON.stringify(loginStatus(), null, 2));
      if (!readLogin()) process.exitCode = 1;
    } finally {
      clearInterval(keepAlive);
    }
  }
}
