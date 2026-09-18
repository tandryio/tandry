import { TandryError, type Output, type ParsedInput } from "@tandryio/protocol";
import { authFor } from "../auth/auth";
import type { Principal } from "../auth/principal";
import { displayCode, summary } from "../directory/directory";
import type { HubContext } from "./execute";
import { roomStub } from "./membership";

const DEVICE_CLIENT = "tandry-cli";

/** The device flow is Better Auth's; these two operations only give it the protocol's shape. */
async function deviceFlow(hub: HubContext, path: "code" | "token", body: Record<string, string>, userAgent?: string) {
  const response = await authFor(hub.env).handler(new Request(`${hub.env.BETTER_AUTH_URL}/api/auth/device/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userAgent ? { "User-Agent": userAgent } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

export async function login_start(hub: HubContext): Promise<Output<"login_start">> {
  const { status, json } = await deviceFlow(hub, "code", { client_id: DEVICE_CLIENT });
  if (status !== 200 || typeof json.device_code !== "string" || typeof json.user_code !== "string")
    throw new TandryError("unavailable", "Could not start sign-in");
  return {
    url: String(json.verification_uri_complete ?? json.verification_uri),
    userCode: json.user_code,
    deviceCode: json.device_code,
    intervalSeconds: Number(json.interval ?? 5),
    expiresInSeconds: Number(json.expires_in ?? 600),
  };
}

export async function login_status(hub: HubContext, input: ParsedInput<"login_status">): Promise<Output<"login_status">> {
  const { status, json } = await deviceFlow(hub, "token", {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: input.deviceCode, client_id: DEVICE_CLIENT,
  }, input.label ? `Tandry on ${input.label}` : "Tandry");
  if (status === 200 && typeof json.access_token === "string") {
    const session = await authFor(hub.env).api.getSession({ headers: new Headers({ Authorization: `Bearer ${json.access_token}` }) });
    if (!session) throw new TandryError("unavailable", "Sign-in was approved but the session could not be read");
    return { state: "approved", token: json.access_token, account: { id: session.user.id, handle: (session.user as { handle?: string | null }).handle ?? null } };
  }
  if (json.error === "authorization_pending" || json.error === "slow_down") return { state: "pending" };
  if (json.error === "access_denied") return { state: "denied" };
  return { state: "expired" };
}

/** Revoking the device is deleting its session. Session cookies are not cached, so it takes effect at once. */
export async function logout(hub: HubContext, who: Principal): Promise<Output<"logout">> {
  if (who.via === "connector") throw new TandryError("forbidden", "Revoke connector access through OAuth");
  await hub.env.AUTH_DB.prepare("DELETE FROM session WHERE id=?").bind(who.sessionId).run();
  return {};
}

export async function status(hub: HubContext, who: Principal): Promise<Output<"status">> {
  return { account: { id: who.accountId, handle: who.handle }, rooms: await hub.directory.roomsOf(who.accountId) };
}

export async function devices(hub: HubContext, who: Principal): Promise<Output<"devices">> {
  if (who.via === "connector") throw new TandryError("forbidden", "Use an account sign-in to manage devices");
  const rows = await hub.env.AUTH_DB.prepare(
    "SELECT id, userAgent, createdAt, expiresAt FROM session WHERE userId=? AND expiresAt>? ORDER BY createdAt DESC, id",
  ).bind(who.accountId, hub.now()).all<{ id: string; userAgent: string | null; createdAt: number; expiresAt: number }>();
  return { devices: rows.results.map((row) => ({
    id: row.id, label: row.userAgent ?? "", createdAt: row.createdAt, expiresAt: row.expiresAt, current: row.id === who.sessionId,
  })) };
}

export async function revoke_device(hub: HubContext, who: Principal, input: ParsedInput<"revoke_device">): Promise<Output<"revoke_device">> {
  if (who.via === "connector") throw new TandryError("forbidden", "Use an account sign-in to manage devices");
  await hub.env.AUTH_DB.prepare("DELETE FROM session WHERE id=? AND userId=?").bind(input.id, who.accountId).run();
  return {};
}

export async function new_room(hub: HubContext, who: Principal, input: ParsedInput<"new_room">): Promise<Output<"new_room">> {
  if (!who.handle) throw new TandryError("handle_required", "The account has no handle yet");
  const existing = await hub.directory.roomById(input.id);
  if (existing && existing.ownerAccountId !== who.accountId) throw new TandryError("invalid_input", "This room ID is already in use");
  if (!existing) {
    const { rooms } = await hub.policy.limits(who.accountId);
    if ((await hub.directory.ownedCount(who.accountId)) >= rooms) throw new TandryError("limit_reached", `This account may own at most ${rooms} rooms`);
  }
  const room = await hub.directory.createRoom(who.accountId, input, hub.now());
  // Both steps are idempotent, so a retry after a failure between them completes the room.
  const initialised = await roomStub(hub.env, room.id).call("init", { accountId: who.accountId, handle: who.handle, protocol: 0 }, {}, room);
  if (!initialised.ok) throw TandryError.from(initialised.error);
  if (!existing) hub.policy.onUsage({ type: "room_created", account: who.accountId, room: room.id });
  return { id: room.id, name: room.name, code: displayCode(room.code) };
}

export async function update_room(hub: HubContext, who: Principal, input: ParsedInput<"update_room">): Promise<Output<"update_room">> {
  const room = await hub.directory.roomById(input.room);
  if (!room) throw new TandryError("no_such_room", "No such room");
  if (room.ownerAccountId !== who.accountId) throw new TandryError("forbidden", "Only the room's owner may change it");
  return summary(await hub.directory.updateRoom(room.id, input), who.accountId);
}
