import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { credentialsPath, readMarker, writeJson, writeMarker } from "@tandryio/bridge/local";
import { startFakeHub, type FakeHub } from "../../../packages/bridge/test/fake-hub";
import { startHost, until } from "./host";

// Exercise Bun's built-in ws inside the actual shipped OpenCode runtime.
// A scripted Hub lets us observe upgrade attempts, rejection bodies and retries.
let hub: FakeHub;
let home: string;
let host: Awaited<ReturnType<typeof startHost>>;
before(async () => {
  hub = await startFakeHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-opencode-link-"));
  process.env.TANDRY_HOME = path.join(home, "tandry");
  process.env.TANDRY_HUB = hub.url;
  writeJson(credentialsPath(), { hub: hub.url, token: "synthetic-token", account: { id: "acct", handle: "henry" } });
  host = await startHost(path.join(home, "host"));
});
after(async () => {
  await host?.close();
  await hub?.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

async function joinedSession() {
  const session = await host.session();
  writeMarker("opencode", session.id, { room: "r_0000000000room01", roomName: "hub-design", code: "4BCD2QQF", member: "henry/hub-refactor" });
  return session.id;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 1_400));
const noWarning = () => assert.doesNotMatch(host.diagnostics(), /\[bun\] Warning:.*ws\.WebSocket/);

test("Bun connects and receives state without unsupported ws event warnings", async () => {
  const id = await joinedSession();
  await host.call(id, "status");
  await until(() => hub.states.length > 0, "connected state frame");
  noWarning();
  assert.equal(hub.calls("members"), 0, "successful connections need no HTTP verification");
  await host.api("DELETE", `/session/${id}`);
});

for (const [code, message, expected] of [
  ["not_in_room", "This member left the room", "has not joined a room"],
  ["not_logged_in", "Device revoked", "no longer accepts this machine's sign-in"],
  ["upgrade_required", "Update Tandry to continue", "Update Tandry to continue"],
] as const) {
  test(`Bun classifies ${code} after rejected upgrade and stops reconnecting`, async () => {
    hub.rejectLinks({ code, message });
    hub.respond("members", { ok: false, error: { code, message } });
    const before = hub.linkUpgrades;
    const checked = hub.calls("members");
    const id = await joinedSession();
    await host.call(id, "status");
    await until(() => hub.calls("members") > checked, "HTTP rejection verification", 3_000);
    await until(async () => (await host.call(id, "status")).includes(expected), "terminal link state");
    await settle();
    assert.equal(hub.linkUpgrades, before + 1, "terminal rejection must not reconnect");
    assert.equal(hub.calls("members"), checked + 1);
    assert.equal(readMarker("opencode", id) === null, code === "not_in_room");
    noWarning();
    await host.api("DELETE", `/session/${id}`);
    hub.rejectLinks(null);
  });
}

test("Bun retries a transient failed handshake after HTTP confirms membership", async () => {
  hub.rejectLinks({ code: "unavailable", message: "Temporary proxy failure" });
  const before = hub.linkUpgrades;
  const checked = hub.calls("members");
  const stateCount = hub.states.length;
  const id = await joinedSession();
  await host.call(id, "status");
  await until(() => hub.calls("members") > checked, "membership check", 3_000);
  hub.rejectLinks(null);
  await until(() => hub.states.length > stateCount, "reconnected state frame");
  assert.equal(hub.linkUpgrades, before + 2);
  assert.equal(hub.calls("members"), checked + 1);
  assert.ok(readMarker("opencode", id));
  noWarning();
  await host.api("DELETE", `/session/${id}`);
});

test("Bun keeps retrying when the HTTP verification also has a transport failure", async () => {
  hub.rejectLinks({ code: "unavailable", message: "Temporary failure" });
  hub.drop("members");
  const before = hub.linkUpgrades;
  const checked = hub.calls("members");
  const stateCount = hub.states.length;
  const id = await joinedSession();
  await host.call(id, "status");
  await until(() => hub.calls("members") > checked, "failed HTTP check", 3_000);
  hub.rejectLinks(null);
  await until(() => hub.states.length > stateCount, "link recovery");
  assert.equal(hub.linkUpgrades, before + 2);
  assert.equal(hub.calls("members"), checked + 1, "HTTP must not have its own retry loop");
  assert.ok(readMarker("opencode", id));
  noWarning();
  await host.api("DELETE", `/session/${id}`);
});

test("disposing during Bun rejection verification ignores the late response", async t => {
  const error = { code: "not_in_room" as const, message: "Membership removed" };
  hub.rejectLinks(error);
  let release!: () => void;
  const gate = new Promise<{ ok: false; error: typeof error }>(resolve => {
    release = () => resolve({ ok: false, error });
  });
  t.after(() => release());
  hub.respond("members", gate);
  const checked = hub.calls("members");
  const before = hub.linkUpgrades;
  const id = await joinedSession();
  await host.call(id, "status");
  await until(() => hub.calls("members") > checked, "pending HTTP check", 3_000);
  await host.api("DELETE", `/session/${id}`);
  release();
  await settle();
  assert.ok(readMarker("opencode", id), "disposed bridges must not apply a late membership result");
  assert.equal(hub.linkUpgrades, before + 1);
  noWarning();
  hub.rejectLinks(null);
});
