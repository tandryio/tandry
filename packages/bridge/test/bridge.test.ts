import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { CLOSE_CODES, renderNotice, type ConversationRef } from "@tandryio/protocol";
import { createBridge, type Bridge, type Shell } from "../src/index";
import { credentialsPath, markerPath, readRun, writeJson } from "../src/local";
import { message, startFakeHub, type FakeHub } from "./fake-hub";

// The bridge is tested through its two faces only: what createBridge returns,
// and the wire. The Hub is a real local server; the shell records its wakes.

const conversation: ConversationRef = { host: "codex", hostConversationId: "thread-1", workspace: { repo: "tandry", branch: "main" } };
const timing = { retryDelaysMs: [5, 5], reconnectDelaysMs: [20], wakeRetryDelaysMs: [5, 5, 5], closeTimeoutMs: 100, loginPollFloorMs: 5 };
const from = ["alice/api-review" as const];

let hub: FakeHub;
let home: string;
let bridges: Bridge[];

class FakeShell implements Shell {
  idleNow = true;
  wakeableNow = true;
  failing = false;
  wakes: string[] = [];
  attempts = 0;
  wakeable() { return this.wakeableNow; }
  idle() { return this.idleNow; }
  async wake(notice: string) {
    this.attempts++;
    if (this.failing) throw new Error("queue command failed");
    this.wakes.push(notice);
  }
}

beforeEach(async () => {
  hub = await startFakeHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-bridge-test-"));
  process.env.TANDRY_HOME = home;
  process.env.TANDRY_HUB = hub.url;
  bridges = [];
});
afterEach(async () => {
  for (const bridge of bridges) bridge.dispose();
  await hub.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

function signIn() {
  writeJson(credentialsPath(), { hub: hub.url, token: "device-token", account: { id: "acct", handle: "henry" } });
}
function markJoined(id = conversation.hostConversationId) {
  writeJson(markerPath("codex", id), { room: "r_0000000000room01", roomName: "hub-design", code: "4BCD2QQF", member: "henry/hub-refactor" });
}
function bridge(shell: Shell = new FakeShell(), extra: Partial<Parameters<typeof createBridge>[0]> = {}) {
  const made = createBridge({ host: "codex", shell, conversation, timing, ...extra });
  bridges.push(made);
  return made;
}
const tool = (made: Bridge, name: string, params: unknown = {}) => made.tools.find((entry) => entry.name === name)!.call(params);
async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

/** A signed-in, joined, linked bridge. */
async function linked(shell = new FakeShell(), extra: Partial<Parameters<typeof createBridge>[0]> = {}) {
  signIn();
  markJoined();
  const made = bridge(shell, extra);
  await until(() => hub.links.length === 1, "the room link");
  return { made, shell };
}

// ---- going online ----------------------------------------------------------

test("a conversation that never joined makes no network request at all", async () => {
  signIn();
  const made = bridge();
  assert.equal(made.tools.length, 9);
  assert.equal(made.inactive(), "This conversation has not joined a room.");
  await settle();
  assert.equal(hub.connections, 0);
});

test("a joined marker alone brings the process online, with the conversation in the headers", async () => {
  const { made } = await linked();
  assert.equal(made.inactive(), null);
  await until(() => hub.states.length === 1, "the state frame");
  assert.deepEqual(hub.states[0], { t: "state", wakeable: true, busy: false });
});

test("join writes the marker and opens the link; leave removes both", async () => {
  signIn();
  const made = bridge();
  const joined = await tool(made, "join", { room: "4bcd-2qqf", intro: "Refactoring the Hub", name: "hub-refactor" });
  assert.match(joined.text, /^Joined #hub-design as henry\/hub-refactor/);
  const request = hub.requests.find((entry) => entry.op === "join")!;
  assert.deepEqual(request.input.workspace, { repo: "tandry", branch: "main" }); // attested by the bridge, not the agent
  assert.equal(request.headers["tandry-conversation"], "thread-1");
  assert.ok(fs.existsSync(markerPath("codex", "thread-1")));
  await until(() => hub.links.length === 1, "the room link");

  assert.match((await tool(made, "leave")).text, /left the room/);
  assert.ok(!fs.existsSync(markerPath("codex", "thread-1")));
  await until(() => hub.links.length === 0, "the link to close");
});

test("joining a second room fails locally and names the current one", async () => {
  const { made } = await linked();
  const before = hub.requests.length;
  const result = await tool(made, "join", { room: "ZZZZ-9999", intro: "x" });
  assert.equal(result.isError, true);
  assert.match(result.text, /^Error already_in_room: This conversation is already henry\/hub-refactor in #hub-design/);
  assert.equal(hub.requests.length, before);
});

test("before the host gives a conversation ID, account tools work and room tools explain", async () => {
  signIn();
  const made = createBridge({ host: "codex", shell: new FakeShell(), timing });
  bridges.push(made);
  assert.match((await tool(made, "status")).text, /Signed in as henry/);
  assert.match((await tool(made, "join", { room: "4BCD-2QQF", intro: "x" })).text, /host has not given this conversation's ID/);
  made.bind(conversation);
  made.bind(conversation);
  assert.throws(() => made.bind({ ...conversation, hostConversationId: "thread-2" }), /bound to one conversation/);
});

test("login shows the code, polls by itself, and stores the device token privately", async () => {
  const made = bridge();
  assert.match((await tool(made, "status")).text, /^Not signed in/);
  const started = await tool(made, "login", { action: "start" });
  assert.match(started.text, /enter the code ABCD/);
  assert.ok(!started.text.includes("device-code"));
  await until(() => fs.existsSync(credentialsPath()), "the credentials file");
  assert.equal(fs.statSync(credentialsPath()).mode & 0o777, 0o600);
  assert.match((await tool(made, "status")).text, /Signed in as henry/);
  assert.match((await tool(made, "login", { action: "logout" })).text, /Signed out/);
  assert.ok(!fs.existsSync(credentialsPath()));
});

// ---- the wake contract -------------------------------------------------------

test("a notice wakes an idle conversation once, and the wake carries only headers", async () => {
  const { shell } = await linked();
  hub.notify({ unread: 2, upTo: 42, from });
  await until(() => shell.wakes.length === 1, "the wake");
  assert.equal(shell.wakes[0], renderNotice({ unread: 2, from }));
  // Later notices merge into the pending one: no second wake while it is unconsumed.
  hub.notify({ unread: 3, upTo: 43, from });
  await settle();
  assert.equal(shell.wakes.length, 1);
});

test("scenario 8: an agent that ignores the notice is not woken again for the same state", async () => {
  const { made, shell } = await linked();
  hub.notify({ unread: 1, upTo: 42, from });
  await until(() => shell.wakes.length === 1, "the wake");
  made.hostChanged();
  hub.notify({ unread: 1, upTo: 42, from }); // e.g. replayed after a reconnect
  made.hostChanged();
  await settle();
  assert.equal(shell.wakes.length, 1);
  assert.equal(made.notice(), null);
});

test("a running turn is never interrupted: the notice waits for a boundary and is given once", async () => {
  const shell = new FakeShell();
  shell.idleNow = false;
  const { made } = await linked(shell);
  hub.notify({ unread: 1, upTo: 42, from });
  await settle();
  assert.equal(shell.attempts, 0);
  assert.equal(made.notice(), renderNotice({ unread: 1, from }));
  assert.equal(made.notice(), null);
  // The turn ends. This state was already announced at the boundary, so no wake follows.
  shell.idleNow = true;
  made.hostChanged();
  await settle();
  assert.equal(shell.attempts, 0);
  await until(() => hub.states.some((state) => state.busy === false), "the idle state frame");
});

test("a shell that cannot wake is reported as such, and hooks still carry the notice", async () => {
  const shell = new FakeShell();
  shell.wakeableNow = false;
  const { made } = await linked(shell);
  await until(() => hub.states.length === 1, "the state frame");
  assert.equal(hub.states[0]?.wakeable, false);
  hub.notify({ unread: 1, upTo: 42, from });
  await settle();
  assert.equal(shell.attempts, 0);
  assert.ok(made.notice());
});

test("a failing wake is retried three times, then stops and shows in status", async () => {
  const shell = new FakeShell();
  shell.failing = true;
  const { made } = await linked(shell);
  hub.notify({ unread: 1, upTo: 42, from });
  await until(() => shell.attempts === 4, "the retries");
  await settle();
  assert.equal(shell.attempts, 4);
  assert.match((await tool(made, "status")).text, /Last wake failed: queue command failed/);
  // The message is still unread and is still read normally.
  hub.inboxQueue.push({ messages: [message(42)], upTo: 42, remaining: null });
  assert.match((await tool(made, "inbox")).text, /message 42/);
});

test("scenario 6: a half-read inbox leaves unread behind, and the idle conversation is woken again", async () => {
  const { made, shell } = await linked(new FakeShell(), { runFile: true });
  hub.notify({ unread: 100, upTo: 100, from });
  await until(() => shell.wakes.length === 1, "the first wake");
  hub.inboxQueue.push({ messages: [message(20)], upTo: 20, remaining: { unread: 80, upTo: 100, from } });
  const result = await tool(made, "inbox");
  assert.match(result.text, /80 more unread from alice\/api-review\. Call inbox again/);
  await until(() => hub.calls("read") === 1, "read");
  assert.deepEqual(hub.requests.find((entry) => entry.op === "read")?.input, { upTo: 20 });
  // The agent stops here and no new mail arrives. Reading part of it made a new state: one more wake.
  await until(() => shell.wakes.length === 2, "the second wake");
  assert.equal(shell.wakes[1], renderNotice({ unread: 80, from }));
  const run = readRun("thread-1")!;
  assert.deepEqual([run.unread, run.upTo, run.wake], [80, 100, 2]);
  await settle();
  assert.equal(shell.wakes.length, 2);
});

test("scenario 7: a notice that arrives between inbox and read is not wiped by the read", async () => {
  const { made, shell } = await linked(new FakeShell(), { runFile: true });
  hub.notify({ unread: 1, upTo: 41, from });
  await until(() => shell.wakes.length === 1, "the first wake");
  hub.inboxQueue.push({ messages: [message(41)], upTo: 41, remaining: null });
  const reading = tool(made, "inbox");
  hub.notify({ unread: 1, upTo: 42, from });
  await reading;
  await until(() => hub.calls("read") === 1, "read");
  await until(() => shell.wakes.length === 2, "the wake for the newer message");
  assert.equal(readRun("thread-1")?.unread, 1);
});

test("command hooks: the run file offers a notice until a hook or a wake has announced that state", async () => {
  const shell = new FakeShell();
  shell.idleNow = false;
  const { made } = await linked(shell, { runFile: true });
  hub.notify({ unread: 1, upTo: 41, from });
  await until(() => readRun("thread-1")?.notice === renderNotice({ unread: 1, from }), "the notice for hooks");
  // A hook in another process injected it and reports the key it saw.
  made.announced(readRun("thread-1")!.key!);
  assert.equal(readRun("thread-1")?.notice, null);
  assert.equal(made.notice(), null);
  // A stale report does not swallow newer mail.
  hub.notify({ unread: 2, upTo: 42, from });
  await until(() => readRun("thread-1")?.unread === 2, "the newer state");
  made.announced("41:0");
  assert.equal(readRun("thread-1")?.notice, renderNotice({ unread: 2, from }));
  // The turn ends: the wake announces it, so a hook that runs next stays silent, and the monitor has its line.
  shell.idleNow = true;
  made.hostChanged();
  await until(() => readRun("thread-1")?.wake === 1, "the wake signal");
  const run = readRun("thread-1")!;
  assert.deepEqual([run.notice, run.wakeNotice], [null, renderNotice({ unread: 2, from })]);
  assert.ok(run.wakeAt > 0);
});

test("reading everything quiets the bridge and empties the run file", async () => {
  const { made, shell } = await linked(new FakeShell(), { runFile: true });
  hub.notify({ unread: 1, upTo: 41, from });
  await until(() => shell.wakes.length === 1, "the wake");
  hub.inboxQueue.push({ messages: [message(41)], upTo: 41, remaining: null });
  await tool(made, "inbox");
  await settle();
  assert.deepEqual([readRun("thread-1")?.unread, readRun("thread-1")?.notice], [0, null]);
  assert.equal(shell.wakes.length, 1);
  assert.equal(made.notice(), null);
});

// ---- failures ----------------------------------------------------------------

test("a lost inbox response is retried; a lost read means the same batch comes back", async () => {
  const { made } = await linked();
  const batch = { messages: [message(41), message(42)], upTo: 42, remaining: null };
  hub.inboxQueue.push(batch, batch);
  hub.drop("inbox"); // a dropped request consumes nothing from the queue
  hub.drop("read"); hub.drop("read"); hub.drop("read");
  const first = await tool(made, "inbox");
  assert.match(first.text, /message 41[\s\S]*message 42/);
  assert.equal(hub.calls("inbox"), 2);
  // read never got through. The next inbox waits for it to give up, then shows the same messages: at least once.
  const second = await tool(made, "inbox");
  assert.match(second.text, /message 41/);
  assert.equal(hub.calls("read") >= 3, true);
});

test("an ordinary drop reconnects; a terminal close code does not", async () => {
  const { made, shell } = await linked();
  hub.closeLinks(1001);
  await until(() => hub.linkUpgrades === 2 && hub.links.length === 1, "the reconnect");
  assert.equal(made.inactive(), null);

  hub.closeLinks(CLOSE_CODES.superseded);
  await until(() => made.inactive() !== null, "the link to end");
  assert.match(made.inactive()!, /now open elsewhere/);
  await settle();
  assert.equal(hub.linkUpgrades, 2);
  // Superseded decides who is told. The marker stays, and the tools keep working.
  assert.ok(fs.existsSync(markerPath("codex", "thread-1")));
  assert.equal((await tool(made, "members")).isError, false);
  assert.equal(shell.wakes.length, 0);
});

test("rebound and not_in_room delete the joined marker and do not reconnect", async () => {
  const { made } = await linked();
  hub.closeLinks(CLOSE_CODES.rebound);
  await until(() => !fs.existsSync(markerPath("codex", "thread-1")), "the marker to go");
  assert.equal(made.inactive(), "This conversation has not joined a room.");
  await settle();
  assert.equal(hub.linkUpgrades, 1);
});

test("a rejected upgrade ends the link: not_in_room forgets the room, an old protocol asks for an update", async () => {
  signIn();
  markJoined();
  hub.rejectLinks({ code: "not_in_room", message: "No member" });
  const made = bridge();
  await until(() => !fs.existsSync(markerPath("codex", "thread-1")), "the marker to go");
  await settle();
  assert.equal(hub.linkUpgrades, 1);
  made.dispose();

  markJoined("thread-2");
  hub.rejectLinks({ code: "upgrade_required", message: "Update the Tandry plugin to 0.9 or later." });
  const old = createBridge({ host: "codex", shell: new FakeShell(), conversation: { ...conversation, hostConversationId: "thread-2" }, timing });
  bridges.push(old);
  await until(() => old.inactive() === "Update the Tandry plugin to 0.9 or later.", "the update notice");
  assert.ok(fs.existsSync(markerPath("codex", "thread-2")));
});

test("an operation answered not_in_room forgets the room", async () => {
  const { made } = await linked();
  hub.respond("send", { ok: false, error: { code: "not_in_room", message: "This conversation does not back a member of this room" } });
  const result = await tool(made, "send", { to: [], body: "hello" });
  assert.match(result.text, /^Error not_in_room/);
  assert.match(result.text, /Call join\./);
  assert.ok(!fs.existsSync(markerPath("codex", "thread-1")));
});

test("the Hub being unreachable is an error the agent sees, and retrying is safe", async () => {
  const { made } = await linked();
  hub.drop("send"); hub.drop("send"); hub.drop("send");
  const result = await tool(made, "send", { to: ["alice/api-review"], body: "hello" });
  assert.match(result.text, /^Error unavailable/);
  const ids = hub.requests.filter((entry) => entry.op === "send").map((entry) => entry.input.id);
  assert.equal(new Set(ids).size, 1); // every retry carried the same message ID
});
