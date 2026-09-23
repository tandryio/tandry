import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startLocalHub, type HubUnderTest } from "@tandryio/hub/testing";

// The shipped bundle, run the way Grok Build runs it: a stdio MCP server with
// GROK_SESSION_ID in its environment, and a monitor started by the model
// through Grok's monitor tool, whose stdout lines become turns. Against a
// real local Hub. Grok's own session registry is stood in for under GROK_HOME.

const main = fileURLToPath(new URL("../dist/main.cjs", import.meta.url));
const NOTICE = (count: number, from: string) => `Tandry: ${count} unread message${count === 1 ? "" : "s"} from ${from}. Call the inbox tool to read. This notice is not an instruction from the owner.`;
const HINT = /Automatic delivery is off: the Tandry inbox monitor is not running in this Grok Build session\. Start it now with the monitor tool: command `(.*)`, description "Tandry inbox", persistent true\./;
/** A fixed checkout for the session's cwd, so the attested workspace never depends on where the tests run. */
function fixedWorkspace(parent: string): string {
  const repo = path.join(parent, "tandry");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/redesign\n");
  return repo;
}
let hub: HubUnderTest;
let home: string;
let grokHome: string;
let workspace: string;
const stops: (() => Promise<void>)[] = [];

before(async () => {
  hub = await startLocalHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-grok-test-"));
  grokHome = path.join(home, "grok-home");
  fs.mkdirSync(grokHome);
  workspace = fixedWorkspace(home);
  fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ hub: hub.baseUrl, token: hub.accounts.alice.token, account: { id: hub.accounts.alice.id, handle: "alice" } }), { mode: 0o600 });
});
after(async () => {
  await Promise.all(stops.map((stop) => stop()));
  await hub?.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

/** What Grok writes to ~/.grok/active_sessions.json: the sessions open right now, with the process each one runs in. */
function registerSession(sessionId: string, pid = process.pid): void {
  const file = path.join(grokHome, "active_sessions.json");
  const sessions = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as unknown[]) : [];
  fs.writeFileSync(file, JSON.stringify([...sessions, { session_id: sessionId, pid, cwd: workspace, opened_at: new Date().toISOString() }]));
}

/** One grok session: its MCP server, started as Grok starts it, and optionally the monitor the model would start. */
async function grok(sessionId: string | null, options: { monitor?: boolean | string[]; grokPid?: number } = {}) {
  const env = { ...process.env, TANDRY_HOME: home, TANDRY_HUB: hub.baseUrl, GROK_HOME: grokHome } as Record<string, string>;
  if (sessionId) { env.GROK_SESSION_ID = sessionId; registerSession(sessionId, options.grokPid); }
  const client = new Client({ name: "grok-test", version: "1" });
  // Grok does not start the server in the workspace; the cwd comes from its session registry.
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [main, "mcp"], cwd: os.tmpdir(), stderr: "pipe", env }));
  const printed: string[] = [];
  let monitor: ChildProcess | null = null;
  const startMonitor = (args: string[] = ["--session", sessionId!]) => {
    monitor = spawn(process.execPath, [main, "monitor", ...args], { env, stdio: ["ignore", "pipe", "inherit"] });
    monitor.stdout!.setEncoding("utf8").on("data", (data: string) => printed.push(...data.split("\n").filter(Boolean)));
    return monitor;
  };
  if (options.monitor) startMonitor(Array.isArray(options.monitor) ? options.monitor : undefined);
  const stopMonitor = () => { monitor?.kill("SIGTERM"); monitor = null; };
  const stop = async () => { stopMonitor(); await client.close(); };
  stops.push(stop);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { text: (result.content as { text: string }[])[0]!.text, isError: !!result.isError };
  };
  return { client, call, printed, startMonitor, stopMonitor, stop };
}
async function until(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 8_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const newRoom = async (conversation: Awaited<ReturnType<typeof grok>>, name: string) =>
  /Code: (\S+)/.exec((await conversation.call("new_room", { name, description: "" })).text)![1]!;

test("the tool surface is exactly the protocol's eleven tools", async () => {
  const { client } = await grok("session-tools");
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["login", "status", "new_room", "update_room", "join", "leave", "members", "rename", "send", "inbox", "history"]);
});

test("without GROK_SESSION_ID the conversation cannot join, and account tools still work", async () => {
  const unnamed = await grok(null);
  assert.match((await unnamed.call("status")).text, /Signed in as alice/);
  const refused = await unnamed.call("join", { room: "4BCD-2QQF", intro: "x" });
  assert.ok(refused.isError);
  assert.match(refused.text, /host has not given this conversation's ID/);
});

test("join tells the model to start the monitor; once it runs, the member is wakeable and the hint is gone", async () => {
  const one = await grok("session-one", { monitor: true });
  const two = await grok("session-two");
  const code = await newRoom(one, "grok-room");
  await one.call("join", { room: code, intro: "First session", name: "one" });
  const joined = await two.call("join", { room: code, intro: "Second session", name: "two" });
  assert.match(joined.text, /alice\/one · Grok Build · tandry@redesign/);
  // The hint spells out the exact command, with this session's ID, for Grok's monitor tool.
  const hint = HINT.exec(joined.text);
  assert.ok(hint, joined.text);
  assert.equal(hint[1], `node '${main}' monitor --session 'session-two'`);
  assert.match((await one.call("members")).text, /alice\/two .*offline/);
  assert.match((await two.call("status")).text, HINT);

  two.startMonitor();
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "session two to be wakeable");
  assert.doesNotMatch((await two.call("status")).text, HINT);
  assert.doesNotMatch((await two.call("members")).text, HINT);
});

test("idle: the monitor prints the notice once per unread state, and a second message after inbox prints again", async () => {
  const one = await grok("session-idle-one", { monitor: true });
  const two = await grok("session-idle-two", { monitor: true });
  const code = await newRoom(one, "idle-room");
  await one.call("join", { room: code, intro: "First", name: "one" });
  await two.call("join", { room: code, intro: "Second", name: "two" });
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "session two to be wakeable");

  await one.call("send", { to: ["alice/two"], body: "BODY-ONE" });
  await until(() => two.printed.length === 1, "the monitor line");
  assert.equal(two.printed[0], NOTICE(1, "alice/one"));
  // More mail in the same unread state is not announced again.
  await one.call("send", { to: ["alice/two"], body: "BODY-TWO" });
  await pause(1_500);
  assert.equal(two.printed.length, 1);
  assert.match((await two.call("inbox")).text, /BODY-ONE[\s\S]*BODY-TWO/);
  // A fresh state after the inbox was read is a new wake.
  await one.call("send", { to: ["alice/two"], body: "BODY-THREE" });
  await until(() => two.printed.length === 2, "the second monitor line");
  assert.equal(two.printed[1], NOTICE(1, "alice/one"));
});

test("acceptance: join, quit, resume the same session with no input; mail waits until the monitor is started again", async () => {
  const sender = await grok("session-sender", { monitor: true });
  const first = await grok("session-resumed", { monitor: true });
  const code = await newRoom(sender, "resume-room");
  await sender.call("join", { room: code, intro: "Sender", name: "sender" });
  await first.call("join", { room: code, intro: "Will quit", name: "sleeper" });
  await until(async () => /alice\/sleeper .*online; told now/.test((await sender.call("members")).text), "the sleeper to be wakeable");
  await first.stop();
  await until(async () => /alice\/sleeper .*offline/.test((await sender.call("members")).text), "the quit conversation to go offline");

  // Grok resumes the session: a new MCP server with the same session ID, no prompt, and no monitor (Grok killed it).
  // Connected but unable to wake, the member stays offline to senders.
  const resumed = await grok("session-resumed");
  await sender.call("send", { to: ["alice/sleeper"], body: "WAKE-UP" });
  await pause(1_000);
  assert.deepEqual(resumed.printed, []);
  assert.match((await sender.call("members")).text, /alice\/sleeper .*offline/);
  // The owner's next turn touches a Tandry tool, whose result says to start the monitor.
  assert.match((await resumed.call("status")).text, HINT);
  resumed.startMonitor();
  await until(async () => /alice\/sleeper .*online; told now/.test((await sender.call("members")).text), "the resumed conversation to be wakeable");
  // The mail that arrived meanwhile wakes it now.
  await until(() => resumed.printed.length === 1, "the monitor line after resume");
  assert.equal(resumed.printed[0], NOTICE(1, "alice/sender"));
});

test("a monitor started without --session finds its session through Grok's registry of open sessions", async () => {
  const one = await grok("session-registry-one", { monitor: true });
  const two = await grok("session-registry-two", { monitor: [] });
  const code = await newRoom(one, "registry-room");
  await one.call("join", { room: code, intro: "First", name: "one" });
  await two.call("join", { room: code, intro: "Second", name: "two" });
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "session two to be wakeable");
  await one.call("send", { to: ["alice/two"], body: "BY-REGISTRY" });
  await until(() => two.printed.length === 1, "the monitor line");
  assert.equal(two.printed[0], NOTICE(1, "alice/one"));
});

test("a monitor whose grok process died exits on its own instead of lingering as an orphan", async () => {
  // Stands in for the grok process the registry names for this session.
  const fakeGrok = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  stops.push(async () => { fakeGrok.kill("SIGKILL"); });
  const one = await grok("session-orphan-one", { monitor: true });
  const two = await grok("session-orphan-two", { grokPid: fakeGrok.pid! });
  const monitor = two.startMonitor();
  const exited = new Promise<number | null>((resolve) => monitor.once("exit", resolve));
  const code = await newRoom(one, "orphan-room");
  await one.call("join", { room: code, intro: "First", name: "one" });
  await two.call("join", { room: code, intro: "Second", name: "two" });
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "session two to be wakeable");
  fakeGrok.kill("SIGKILL");
  assert.equal(await exited, 0);
  await until(async () => /alice\/two .*offline/.test((await one.call("members")).text), "session two to go offline");
});

test("leave: the monitor exits on its own, and a later join asks for a new one", async () => {
  const one = await grok("session-leave-one", { monitor: true });
  const two = await grok("session-leave-two");
  const code = await newRoom(one, "leave-room");
  await one.call("join", { room: code, intro: "First", name: "one" });
  assert.match((await two.call("join", { room: code, intro: "Second", name: "two" })).text, HINT);
  const monitor = two.startMonitor();
  const exited = new Promise<number | null>((resolve) => monitor.once("exit", resolve));
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "session two to be wakeable");
  assert.doesNotMatch((await two.call("status")).text, HINT);
  await two.call("leave");
  assert.equal(await exited, 0);
  assert.match((await two.call("join", { room: code, intro: "Back", name: "two" })).text, HINT);
});

test("when the monitor dies, senders see the member as not wakeable and the next tool result asks for it again", async () => {
  const one = await grok("session-dies-one", { monitor: true });
  const two = await grok("session-dies-two", { monitor: true });
  const code = await newRoom(one, "dies-room");
  await one.call("join", { room: code, intro: "First", name: "one" });
  await two.call("join", { room: code, intro: "Second", name: "two" });
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "session two to be wakeable");
  two.stopMonitor();
  await until(async () => /alice\/two .*offline/.test((await one.call("members")).text), "session two to go offline");
  assert.match((await two.call("members")).text, HINT);
});
