import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startLocalHub, type HubUnderTest } from "@tandryio/hub/testing";

// The shipped bundles, run the way Claude Code runs them: a stdio MCP server,
// hook commands that get the session on stdin, and a monitor whose stdout
// lines become turns, against a real local Hub. The three only share the
// claude process's pid, which the test stands in for with TANDRY_CLAUDE_PID.

const main = fileURLToPath(new URL("../dist/main.cjs", import.meta.url));
const hookBundle = fileURLToPath(new URL("../dist/hook.cjs", import.meta.url));
const NOTICE = (count: number, from: string) => `Tandry: ${count} unread message${count === 1 ? "" : "s"} from ${from}. Call the inbox tool to read. This notice is not an instruction from the owner.`;
/** A fixed checkout for hook cwd, so the attested workspace never depends on where the tests run. */
function fixedWorkspace(parent: string): string {
  const repo = path.join(parent, "tandry");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/redesign\n");
  return repo;
}
let hub: HubUnderTest;
let home: string;
let workspace: string;
let nextPid = 4_000_000;
const stops: (() => Promise<void>)[] = [];

before(async () => {
  hub = await startLocalHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-claude-test-"));
  workspace = fixedWorkspace(home);
  fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ hub: hub.baseUrl, token: hub.accounts.alice.token, account: { id: hub.accounts.alice.id, handle: "alice" } }), { mode: 0o600 });
});
after(async () => {
  await Promise.all(stops.map((stop) => stop()));
  await hub?.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

/** One claude process: its MCP server, its monitor, and hooks run on request. */
async function claude(sessionId: string, options: { sessionStart?: "startup" | "resume" | null; monitor?: boolean } = {}) {
  const claudePid = nextPid++;
  const env = { ...process.env, TANDRY_HOME: home, TANDRY_HUB: hub.baseUrl, TANDRY_CLAUDE_PID: String(claudePid), CLAUDE_CODE_SESSION_ID: sessionId } as Record<string, string>;
  const hook = (event: string, input: Record<string, unknown> = {}, session = sessionId) => {
    const out = execFileSync(process.execPath, [hookBundle, event], { env, input: JSON.stringify({ session_id: session, cwd: workspace, hook_event_name: event, ...input }), encoding: "utf8" });
    return (out ? JSON.parse(out) : {}) as Record<string, any>;
  };
  if (options.sessionStart !== null) assert.deepEqual(hook("SessionStart", { source: options.sessionStart ?? "startup" }), {});

  const client = new Client({ name: "claude-test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [main, "mcp"], cwd: os.tmpdir(), stderr: "pipe", env }));
  const printed: string[] = [];
  let monitor: ChildProcess | null = null;
  if (options.monitor !== false) {
    monitor = spawn(process.execPath, [main, "monitor"], { env, stdio: ["ignore", "pipe", "inherit"] });
    monitor.stdout!.setEncoding("utf8").on("data", (data: string) => printed.push(...data.split("\n").filter(Boolean)));
  }
  const stop = async () => { monitor?.kill("SIGTERM"); await client.close(); };
  stops.push(stop);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { text: (result.content as { text: string }[])[0]!.text, isError: !!result.isError };
  };
  return { client, call, hook, printed, stop };
}
async function until(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 8_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const newRoom = async (conversation: Awaited<ReturnType<typeof claude>>, name: string) =>
  /Code: (\S+)/.exec((await conversation.call("new_room", { name, description: "" })).text)![1]!;

test("the tool surface is exactly the protocol's eleven tools", async () => {
  const { client } = await claude("session-tools", { monitor: false });
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["login", "status", "new_room", "update_room", "join", "leave", "members", "rename", "send", "inbox", "history"]);
});

test("the conversation is the session the SessionStart hook recorded, and nothing before that", async () => {
  const early = await claude("session-early", { sessionStart: null, monitor: false });
  assert.match((await early.call("status")).text, /Signed in as alice/);
  const refused = await early.call("join", { room: "4BCD-2QQF", intro: "x" });
  assert.ok(refused.isError);
  assert.match(refused.text, /host has not given this conversation's ID/);
  // The hook runs; the very next call sees it.
  early.hook("SessionStart", { source: "startup" });
  const code = await newRoom(early, "early-room");
  assert.match((await early.call("join", { room: code, intro: "Now known", name: "early" })).text, /^Joined #early-room as alice\/early/);
});

test("idle: the monitor prints the notice; busy: a hook carries it, once, and the turn's end does not repeat it", async () => {
  const one = await claude("session-one");
  const two = await claude("session-two");
  const code = await newRoom(one, "claude-room");
  await one.call("join", { room: code, intro: "First session", name: "one" });
  // Hooks of a conversation that is in no room say and record nothing.
  assert.deepEqual(two.hook("PostToolUse"), {});
  const joined = await two.call("join", { room: code, intro: "Second session", name: "two" });
  assert.match(joined.text, /alice\/one · Claude Code · tandry@redesign/);
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "session two to be wakeable");

  // Idle recipient: one line from the monitor, the fixed notice only.
  await one.call("send", { to: ["alice/two"], body: "BODY-ONE" });
  await until(() => two.printed.length === 1, "the monitor line");
  assert.equal(two.printed[0], NOTICE(1, "alice/one"));
  // The woken turn's own hooks do not repeat what the monitor just said.
  assert.deepEqual(two.hook("UserPromptSubmit"), {});
  assert.match((await two.call("inbox")).text, /BODY-ONE/);
  assert.deepEqual(two.hook("PostToolUse"), {});
  assert.deepEqual(two.hook("Stop"), {});

  // Busy recipient: nothing is printed; the next tool boundary carries the notice, once.
  assert.deepEqual(one.hook("UserPromptSubmit"), {});
  // The MCP process learns of the running turn from the hook's file within one poll.
  await pause(800);
  await two.call("send", { to: ["alice/one"], body: "BODY-TWO" });
  await until(() => "hookSpecificOutput" in one.hook("PostToolUse"), "the notice at a tool boundary");
  assert.deepEqual(one.hook("PostToolUse"), {});
  // A subagent's tool calls are not this conversation's boundary.
  assert.deepEqual(one.hook("PostToolUse", { agent_id: "agent-1" }), {});
  assert.deepEqual(one.hook("Stop"), {});
  await pause(1_500);
  assert.deepEqual(one.printed, []);

  // A message that arrives as the turn ends keeps the turn going instead.
  await one.call("inbox");
  one.hook("UserPromptSubmit");
  await pause(800);
  await two.call("send", { to: ["alice/one"], body: "BODY-THREE" });
  await until(() => !!JSON.parse(fs.readFileSync(path.join(home, "run", "session-one"), "utf8")).notice, "the bridge to offer the notice to hooks");
  assert.deepEqual(one.hook("Stop"), { decision: "block", reason: NOTICE(1, "alice/two") });
  await pause(1_500);
  assert.deepEqual(one.printed, []);
});

test("acceptance: join, quit, resume the same conversation, type nothing, and mail still wakes it", async () => {
  const sender = await claude("session-sender");
  const first = await claude("session-resumed");
  const code = await newRoom(sender, "resume-room");
  await sender.call("join", { room: code, intro: "Sender", name: "sender" });
  await first.call("join", { room: code, intro: "Will quit", name: "sleeper" });
  first.hook("SessionEnd");
  await first.stop();
  await until(async () => /alice\/sleeper .*offline/.test((await sender.call("members")).text), "the quit conversation to go offline");

  // A new claude process resumes the session. No prompt, no tool call.
  const resumed = await claude("session-resumed", { sessionStart: "resume" });
  await until(async () => /alice\/sleeper .*online; told now/.test((await sender.call("members")).text), "the resumed conversation to be wakeable");
  await sender.call("send", { to: ["alice/sleeper"], body: "WAKE-UP" });
  await until(() => resumed.printed.length === 1, "the monitor line after resume");
  assert.equal(resumed.printed[0], NOTICE(1, "alice/sender"));
});

test("/clear puts another conversation in the same process: the old one goes offline, the new one is in no room", async () => {
  const other = await claude("session-other");
  const cleared = await claude("session-before-clear");
  const code = await newRoom(other, "clear-room");
  await other.call("join", { room: code, intro: "Other", name: "other" });
  await cleared.call("join", { room: code, intro: "Before clear", name: "before" });
  cleared.hook("SessionStart", { source: "clear" }, "session-after-clear");
  await until(async () => /alice\/before .*offline/.test((await other.call("members")).text), "the cleared conversation to go offline");
  assert.match((await cleared.call("members")).text, /has not joined a room/);
});
