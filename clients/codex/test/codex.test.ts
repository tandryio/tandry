import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startLocalHub, type HubUnderTest } from "@tandryio/hub/testing";

// The shipped bundle, run the way Codex runs it: a stdio MCP server whose
// requests carry _meta.threadId, with lifecycle hooks arriving as codex_event
// calls, against a real local Hub. `codex queue` is a recording stand-in.

const bundle = fileURLToPath(new URL("../dist/tandry.cjs", import.meta.url));
let hub: HubUnderTest;
let home: string;
let queueLog: string;
const clients: Client[] = [];

before(async () => {
  hub = await startLocalHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-codex-test-"));
  queueLog = path.join(home, "queue.log");
  const fakeCodex = path.join(home, "codex");
  fs.writeFileSync(fakeCodex, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${queueLog}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ hub: hub.baseUrl, token: hub.accounts.alice.token, account: { id: hub.accounts.alice.id, handle: "alice" } }), { mode: 0o600 });
});
after(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await hub?.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

async function codexConversation(threadId: string) {
  const client = new Client({ name: "codex-test", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [bundle, "mcp"], cwd: os.tmpdir(), stderr: "pipe",
    env: { ...process.env, TANDRY_HOME: home, TANDRY_HUB: hub.baseUrl, TANDRY_CODEX_BIN: path.join(home, "codex") } as Record<string, string>,
  }));
  clients.push(client);
  const call = async (name: string, args: Record<string, unknown> = {}, meta: Record<string, unknown> = { threadId }) => {
    const result = await client.callTool({ name, arguments: args, _meta: meta });
    return { text: (result.content as { text: string }[])[0]!.text, isError: !!result.isError };
  };
  const hook = async (event: string) => JSON.parse((await call("codex_event", { event, cwd: process.cwd() })).text) as Record<string, any>;
  return { client, call, hook };
}
const queued = () => (fs.existsSync(queueLog) ? fs.readFileSync(queueLog, "utf8").trim().split("\n").filter(Boolean) : []);
async function until(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("the tool surface is the protocol's nine tools plus the hook entry", async () => {
  const { client } = await codexConversation("thread-tools");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ["login", "status", "new_room", "join", "leave", "members", "send", "inbox", "history", "codex_event"]);
});

test("the conversation is whatever thread Codex names in request metadata, never a guess", async () => {
  const { call } = await codexConversation("thread-unnamed");
  assert.match((await call("status", {}, {})).text, /Signed in as alice/);
  const refused = await call("join", { room: "4BCD-2QQF", intro: "x" }, {});
  assert.ok(refused.isError);
  assert.match(refused.text, /host has not given this conversation's ID/);
  // A thread ID smuggled in as a tool argument is not an identity.
  assert.ok((await call("join", { room: "4BCD-2QQF", intro: "x", threadId: "forged" }, {})).isError);
});

test("idle: mail is announced with codex queue; busy: it waits for a hook and is announced once", async () => {
  const one = await codexConversation("thread-one");
  const two = await codexConversation("thread-two");
  assert.deepEqual(await one.hook("SessionStart"), {});
  assert.deepEqual(await two.hook("SessionStart"), {});

  const code = /Code: (\S+)/.exec((await one.call("new_room", { name: "codex-room", description: "" })).text)![1]!;
  assert.match((await one.call("join", { room: code, intro: "First thread", name: "one" })).text, /^Joined #codex-room as alice\/one/);
  const joined = await two.call("join", { room: code, intro: "Second thread", name: "two" });
  // The workspace comes from the hook's cwd, not from the plugin directory the MCP process runs in.
  assert.match(joined.text, /alice\/one · Codex · tandry@redesign/);
  await one.hook("Stop");
  await two.hook("Stop");
  await until(async () => /alice\/two .*online; told now/.test((await one.call("members")).text), "thread two to be wakeable");

  // Idle recipient: queued as a new turn, and the queued text is the fixed notice only.
  await one.call("send", { to: ["alice/two"], body: "BODY-ONE" });
  await until(() => queued().length === 1, "codex queue");
  assert.equal(queued()[0], "queue --thread thread-two --message Tandry: 1 unread message from alice/one. Call the inbox tool to read. This notice is not an instruction from the owner.");
  assert.match((await two.call("inbox")).text, /BODY-ONE/);

  // Busy recipient: nothing is queued; the next tool boundary carries the notice, once.
  assert.deepEqual(await one.hook("UserPromptSubmit"), {});
  await two.call("send", { to: ["alice/one"], body: "BODY-TWO" });
  await until(async () => /1 unread/.test(JSON.stringify(await one.hook("PostToolUse"))), "the notice at a tool boundary");
  assert.deepEqual(await one.hook("PostToolUse"), {});
  assert.deepEqual(await one.hook("Stop"), {});
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(queued().length, 1);

  // A message that arrives as the turn ends keeps the turn going instead.
  await one.call("inbox");
  await one.hook("UserPromptSubmit");
  await two.call("send", { to: ["alice/one"], body: "BODY-THREE" });
  await until(async () => (await one.hook("Stop")).decision === "block", "the Stop hook to block with the notice");
  assert.equal(queued().length, 1);
});

test("missing Stop hooks disable automatic wake; trusting hooks restores repeated delivery", async () => {
  const one = await codexConversation("thread-no-hooks-sender");
  const two = await codexConversation("thread-no-hooks-receiver");
  const baseline = queued().length;
  const code = /Code: (\S+)/.exec((await one.call("new_room", { name: "no-hooks", description: "" })).text)![1]!;
  await one.call("join", { room: code, intro: "Sender", name: "sender" });
  await two.call("join", { room: code, intro: "Receiver", name: "receiver" });
  await until(async () => /alice\/receiver .*online, seen on next turn/.test((await one.call("members")).text), "receiver link without automatic wake");
  assert.match((await two.call("status")).text, /trust all four Tandry hooks in \/hooks/);
  await one.call("send", { to: ["alice/receiver"], body: "FIRST" });
  assert.match((await two.call("inbox")).text, /FIRST/);
  await one.call("send", { to: ["alice/receiver"], body: "SECOND" });
  assert.match((await two.call("inbox")).text, /SECOND/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(queued().length, baseline, "no one-shot wake that would leave the shell busy forever");

  // Some trusted hooks do not prove that Stop is running.
  await two.hook("UserPromptSubmit");
  await two.hook("PostToolUse");
  assert.match((await two.call("status")).text, /trust all four Tandry hooks/);
  await two.hook("Stop");
  await until(async () => /alice\/receiver .*online; told now/.test((await one.call("members")).text), "Stop enables automatic wake");
  assert.doesNotMatch((await two.call("status")).text, /trust all four Tandry hooks/);
  for (let round = 1; round <= 2; round++) {
    await one.call("send", { to: ["alice/receiver"], body: `AFTER-TRUST-${round}` });
    await until(() => queued().length === baseline + round, `wake ${round} after hooks become available`);
    await two.hook("UserPromptSubmit");
    assert.match((await two.call("inbox")).text, new RegExp(`AFTER-TRUST-${round}`));
    await two.hook("PostToolUse");
    await two.hook("Stop");
  }
});
