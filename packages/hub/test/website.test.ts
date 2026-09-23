import assert from "node:assert/strict";
import WebSocket from "ws";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import {
  TandryError, contextHeaders, decodeResult, encodeCall, newId,
  type CallContext, type Input, type OperationName, type Output,
} from "@tandryio/protocol";
import { startLocalHub, type HubUnderTest, type TestAccount } from "../testing/start";

let hub: HubUnderTest;
before(async () => { hub = await startLocalHub({ vars: { SEND_BUCKET_SIZE: "1000" } }); });
after(async () => { await hub?.stop(); });
const fails = (code: string) => (error: unknown) => error instanceof TandryError && error.code === code;
function cookie(account: TestAccount) {
  const signature = createHmac("sha256", "only-for-local-tests-not-a-production-secret-1234").update(account.token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${account.token}.${signature}`)}`;
}
async function call<K extends OperationName>(account: TestAccount, op: K, input: Input<K>, context: CallContext = {}): Promise<Output<K>> {
  const request = encodeCall(op, context, input);
  const response = await fetch(hub.baseUrl + request.path, {
    ...request, headers: { ...request.headers, Cookie: cookie(account), Origin: hub.baseUrl },
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return decodeResult(op, response.status, await response.json());
}
async function fixture() {
  const alice = hub.accounts.alice, bob = hub.accounts.bob;
  const room = await call(alice, "new_room", { id: newId("r"), name: "Website review", description: "Observer isolation" });
  const context = { room: room.id };
  const a = { ...context, conversation: { host: "codex" as const, hostConversationId: crypto.randomUUID() } };
  const b = { ...context, conversation: { host: "claude" as const, hostConversationId: crypto.randomUUID() } };
  const b2 = { ...context, conversation: { host: "dsh" as const, hostConversationId: crypto.randomUUID() } };
  for (const [account, ctx, name] of [[alice, a, "main"], [bob, b, "main"], [bob, b2, "private"]] as const)
    await call(account, "join", { code: room.code, intro: `Working on ${name}`, name, workspace: { repo: "tandry", branch: "redesign" } }, ctx);
  return { alice, bob, room, context, a, b, b2 };
}

test("cookie observers see public history and their own correspondence without consuming inboxes", async () => {
  const { alice, bob, context, a, b } = await fixture();
  const own = await call(alice, "send", { id: newId("m"), to: ["bob/main"], body: "Our private mail", dm: true }, a);
  const hidden = await call(bob, "send", { id: newId("m"), to: ["bob/private"], body: "Bob only", dm: true }, b);
  const publicMessage = await call(bob, "send", { id: newId("m"), to: [], body: "Room record" }, b);
  const all = await call(alice, "history", {}, context);
  assert.ok(all.messages.some((m) => m.id === own.id && m.owned));
  assert.ok(all.messages.some((m) => m.id === publicMessage.id && !m.owned));
  assert.ok(!all.messages.some((m) => m.id === hidden.id));
  const publicHistory = await call(alice, "history", { view: "room" }, context);
  assert.ok(publicHistory.messages.every((m) => m.visibility === "room"));
  const correspondence = await call(alice, "history", { view: "correspondence" }, context);
  assert.ok(correspondence.messages.some((m) => m.id === own.id));
  assert.ok(!correspondence.messages.some((m) => m.id === publicMessage.id || m.id === hidden.id));
  assert.deepEqual((await call(alice, "members", {}, context)).members.map((m) => m.owned), [true, false, false]);
  assert.equal((await call(bob, "inbox", {}, b)).messages.filter((m) => m.id === own.id).length, 1);
  assert.ok((await call(alice, "history", {}, a)).messages.every((m) => m.owned === undefined && m.recipients === undefined));
  await assert.rejects(call(alice, "send", { id: newId("m"), to: [], body: "No website chat" }, context), fails("invalid_input"));
  await assert.rejects(call(hub.accounts.nohandle, "history", {}, context), fails("forbidden"));
});

test("recipient state follows exact member stays, reads and replies; observing never advances read position", async () => {
  const { alice, bob, room, context, a, b } = await fixture();
  const first = await call(alice, "send", { id: newId("m"), to: ["bob/main"], body: "Read this" }, a);
  const state = async (id: string) => (await call(alice, "history", {}, context)).messages.find((m) => m.id === id)!.recipients![0]!.state;
  assert.equal(await state(first.id), "unread");
  await call(bob, "history", {}, context);
  assert.equal(await state(first.id), "unread");
  await call(bob, "read", { upTo: first.seq }, b);
  assert.equal(await state(first.id), "read");
  await call(bob, "send", { id: newId("m"), to: [], body: "Done", replyTo: first.id }, b);
  assert.equal(await state(first.id), "replied");
  const abandoned = await call(alice, "send", { id: newId("m"), to: ["bob/main"], body: "For the old stay" }, a);
  await call(bob, "leave", {}, b);
  assert.equal(await state(abandoned.id), "left");
  await call(bob, "join", { code: room.code, name: "main", intro: "New stay", workspace: { repo: "", branch: "" } }, b);
  await call(bob, "read", { upTo: 99999 }, b);
  assert.equal(await state(abandoned.id), "left");
  assert.equal(await state(first.id), "replied");
});

test("history applies visibility and correspondence filters before paginating", async () => {
  const { alice, bob, context, a, b } = await fixture();
  const ids: string[] = [];
  for (let i = 0; i < 35; i++) {
    ids.push((await call(alice, "send", { id: newId("m"), to: ["bob/main"], body: `Private ${i}`, dm: true }, a)).id);
    await call(bob, "send", { id: newId("m"), to: [], body: `Public ${i}` }, b);
  }
  const first = await call(alice, "history", { view: "correspondence" }, context);
  assert.equal(first.messages.length, 30);
  assert.deepEqual(first.messages.map((m) => m.id), ids.slice(5));
  assert.ok(first.nextBefore);
  const older = await call(alice, "history", { view: "correspondence", before: first.nextBefore }, context);
  assert.equal(older.nextBefore, null);
  assert.deepEqual(older.messages.filter((m) => m.kind === "text").map((m) => m.id), ids.slice(0, 5));
  const publicHistory = await call(alice, "history", { view: "room" }, context);
  assert.equal(publicHistory.messages.length, 30);
  assert.ok(publicHistory.messages.every((m) => m.visibility === "room"));
});

test("only the sender's account can delete; tombstones survive retries and disappear from unread mail", async () => {
  const { alice, bob, context, a, b } = await fixture();
  const input = { id: newId("m"), to: ["alice/main"], body: "Remove this secret", dm: true, meta: { private: "metadata" } };
  const sent = await call(bob, "send", input, b);
  await assert.rejects(call(alice, "delete_message", { id: sent.id }, context), fails("no_such_message"));
  await call(bob, "delete_message", { id: sent.id }, context);
  await call(bob, "delete_message", { id: sent.id }, context);
  assert.equal((await call(bob, "send", input, b)).seq, sent.seq);
  const tombstone = (await call(alice, "history", {}, context)).messages.find((m) => m.id === sent.id)!;
  assert.equal(tombstone.body, "");
  assert.equal(tombstone.meta, undefined);
  assert.ok(tombstone.deletedAt);
  assert.ok(!(await call(alice, "inbox", {}, a)).messages.some((m) => m.id === sent.id));
  assert.equal((await call(bob, "members", {}, b)).members.find((m) => m.address === "alice/main")!.unreadFromMe, 0);
  const intro = (await call(bob, "history", {}, context)).messages.find((m) => m.kind === "intro" && m.from === "bob/main")!;
  await call(bob, "delete_message", { id: intro.id }, context);
  assert.equal((await call(bob, "members", {}, context)).members.find((m) => m.address === "bob/main")!.intro, "");
});

test("observer member management enforces ownership and removal drops access", async () => {
  const { alice, bob, context, a } = await fixture();
  await assert.rejects(call(bob, "rename", { member: "alice/main", name: "stolen" }, context), fails("forbidden"));
  await assert.rejects(call(alice, "rename", { member: "bob/main", name: "stolen" }, context), fails("forbidden"));
  await call(alice, "rename", { member: "alice/main", name: "renamed" }, context);
  assert.ok((await call(alice, "members", {}, a)).members.some((m) => m.address === "alice/renamed"));
  await assert.rejects(call(bob, "leave", { member: "alice/renamed" }, context), fails("forbidden"));
  await call(alice, "leave", { member: "bob/main" }, context);
  await call(bob, "leave", { member: "bob/private" }, context);
  await assert.rejects(call(bob, "history", {}, context), fails("forbidden"));
  assert.ok(!(await call(bob, "status", {})).rooms.some((r) => r.id === context.room));
});

test("website presence distinguishes a working push host from idle and offline", async () => {
  const { alice, context, a } = await fixture();
  const socket = new WebSocket(hub.baseUrl.replace("http", "ws") + "/v1/link", { headers: contextHeaders({ ...a, token: alice.token }) });
  try {
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    socket.send(JSON.stringify({ t: "state", wakeable: true, busy: true }));
    const deadline = Date.now() + 3000;
    for (;;) {
      const member = (await call(alice, "members", {}, context)).members.find((m) => m.address === "alice/main")!;
      if (member.busy) { assert.equal(member.state, "online"); break; }
      assert.ok(Date.now() < deadline, "Host busy state did not reach the website");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally { socket.terminate(); }
});

test("device management returns no tokens, isolates accounts and revokes HTTP access immediately", async () => {
  const alice = hub.accounts.alice, bob = hub.accounts.bob, other = hub.accounts.nohandle;
  const list = await call(alice, "devices", {});
  assert.equal(list.devices.length, 1);
  assert.equal(list.devices[0]!.current, true);
  assert.equal(JSON.stringify(list).includes(alice.token), false);
  assert.equal(JSON.stringify(list).includes(bob.token), false);
  await call(alice, "revoke_device", { id: (await call(bob, "devices", {})).devices[0]!.id });
  assert.ok((await call(bob, "status", {})).account);
  const login = await call(alice, "login_start", {});
  const headers = { Cookie: cookie(alice), Origin: hub.baseUrl, "Content-Type": "application/json" };
  assert.equal((await fetch(hub.baseUrl + "/api/auth/device?" + new URLSearchParams({ user_code: login.userCode }), { headers })).status, 200);
  assert.equal((await fetch(hub.baseUrl + "/api/auth/device/approve", { method: "POST", headers, body: JSON.stringify({ userCode: login.userCode }) })).status, 200);
  const approved = await call(alice, "login_status", { deviceCode: login.deviceCode, label: "Test laptop" });
  assert.equal(approved.state, "approved");
  if (approved.state !== "approved") throw new Error("Device approval failed");
  const device = (await call(alice, "devices", {})).devices.find((d) => !d.current)!;
  assert.equal(device.label, "Tandry on Test laptop");
  assert.ok(device.createdAt <= Date.now() && device.expiresAt > Date.now());
  await call(alice, "revoke_device", { id: device.id });
  await call(alice, "revoke_device", { id: device.id });
  assert.equal((await call(alice, "devices", {})).devices.length, 1);
  await assert.rejects(call({ ...alice, token: approved.token }, "status", {}), fails("not_logged_in"));
  const request = encodeCall("revoke_device", {}, { id: list.devices[0]!.id });
  const csrf = await fetch(hub.baseUrl + request.path, { ...request, headers: { ...request.headers, Cookie: cookie(alice), Origin: "https://foreign.example.test" } });
  assert.equal(csrf.status, 403);
  await call(other, "revoke_device", { id: (await call(other, "devices", {})).devices[0]!.id });
  await assert.rejects(call(other, "status", {}), fails("not_logged_in"));
  const bearer = encodeCall("status", { token: other.token }, {});
  const denied = await fetch(hub.baseUrl + bearer.path, bearer);
  assert.equal(denied.status, 401);
});

test("self-hosted accounts can create more than 100 rooms by default", async () => {
  for (let index = 0; index < 101; index++) {
    const id = newId("r");
    const room = await call(hub.accounts.alice, "new_room", { id, name: `Unlimited ${index}`, description: "" });
    assert.equal(room.id, id);
  }
});

// A real 1×1 PNG: the route sniffs the bytes, so a plausible header is not enough.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
function storePicture(account: TestAccount | null, body: BodyInit, headers: Record<string, string> = {}) {
  return fetch(`${hub.baseUrl}/api/avatar`, {
    method: "POST", body,
    headers: { Origin: hub.baseUrl, "Content-Type": "image/png", ...(account ? { Cookie: cookie(account) } : {}), ...headers },
  });
}

test("a picture is stored once, served immutably, and reaches the room's member list", async () => {
  const { alice, bob, context, b } = await fixture();
  const stored = await storePicture(alice, PNG);
  assert.equal(stored.status, 200);
  const { image } = (await stored.json()) as { image: string };
  assert.match(image, /^\/api\/avatar\/[0-9a-f]{32}$/);

  const served = await fetch(hub.baseUrl + image);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("Content-Type"), "image/png");
  assert.equal(served.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(served.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), new Uint8Array(PNG));

  // An observer sees the owners' pictures; the same call from a conversation does not.
  const observed = await call(bob, "members", {}, context);
  assert.equal(observed.members.find((member) => member.address === "alice/main")?.avatar, image);
  assert.equal(observed.members.find((member) => member.address === "bob/main")?.avatar, undefined);
  assert.ok((await call(bob, "members", {}, b)).members.every((member) => member.avatar === undefined));

  // Replacing it lands on a new key and drops the object the account left behind.
  const replaced = (await (await storePicture(alice, PNG)).json()) as { image: string };
  assert.notEqual(replaced.image, image);
  assert.equal((await fetch(hub.baseUrl + image)).status, 404);
  assert.equal((await call(bob, "members", {}, context)).members.find((member) => member.address === "alice/main")?.avatar, replaced.image);
});

test("storing a picture needs this origin, a signed-in account, and bytes that are a raster image", async () => {
  const alice = hub.accounts.alice;
  assert.equal((await storePicture(alice, '<svg xmlns="http://www.w3.org/2000/svg"/>', { "Content-Type": "image/svg+xml" })).status, 400);
  assert.equal((await storePicture(alice, PNG, { Origin: "https://elsewhere.test" })).status, 403);
  assert.equal((await storePicture(null, PNG)).status, 401);
  assert.equal((await fetch(`${hub.baseUrl}/api/avatar/not-a-key`)).status, 404);
  assert.equal((await fetch(`${hub.baseUrl}/api/avatar/${"0".repeat(32)}`)).status, 404);
});

test("only the owner can permanently delete a room; links close and retries cannot resurrect it", async () => {
  const { alice, bob, room, context, a, b } = await fixture();
  await call(alice, "send", { id: newId("m"), to: ["bob/main"], body: "Private data", dm: true }, a);
  await assert.rejects(call(bob, "delete_room", { room: room.id }), fails("forbidden"));
  assert.ok((await call(bob, "history", {}, context)).messages.length);
  const socket = new WebSocket(hub.baseUrl.replace(/^http/, "ws") + "/v1/link", {
    headers: contextHeaders({ ...b, token: bob.token }), closeTimeout: 100,
  } as WebSocket.ClientOptions);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const closed = new Promise<number>((resolve) => socket.once("close", resolve));
  await call(alice, "delete_room", { room: room.id });
  assert.equal(await closed, 4003);
  await call(alice, "delete_room", { room: room.id });
  for (const account of [alice, bob]) {
    assert.ok(!(await call(account, "status", {})).rooms.some((r) => r.id === room.id));
    await assert.rejects(call(account, "history", {}, context), fails("not_in_room"));
  }
  await assert.rejects(call(bob, "inbox", {}, b), fails("not_in_room"));
  await assert.rejects(call(bob, "join", { code: room.code, intro: "Retry", workspace: { repo: "", branch: "" } }, b), fails("no_such_room"));
  await assert.rejects(call(alice, "new_room", { id: room.id, name: "Retry", description: "" }), fails("not_in_room"));
  assert.ok(!(await call(alice, "status", {})).rooms.some((r) => r.id === room.id));
});
