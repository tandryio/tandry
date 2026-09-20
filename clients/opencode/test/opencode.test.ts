import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createBridge } from "@tandryio/bridge";
import { credentialsPath, readMarker, writeJson } from "@tandryio/bridge/local";
import { startLocalHub, type HubUnderTest } from "../../../packages/hub/testing/start";
import { startHost, until } from "./host";
let hub: HubUnderTest;
let home: string;
let host: Awaited<ReturnType<typeof startHost>>;
const cleanups: Array<() => void> = [];
before(async () => {
  hub = await startLocalHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-opencode-"));
  process.env.TANDRY_HOME = path.join(home, "tandry");
  process.env.TANDRY_HUB = hub.baseUrl;
  writeJson(credentialsPath(), { hub: hub.baseUrl, token: hub.accounts.alice.token, account: { id: hub.accounts.alice.id, handle: "alice" } });
  host = await startHost(path.join(home, "host"));
});
after(async () => {
  await host?.close();
  for (const close of cleanups) close();
  await hub?.stop();
  fs.rmSync(home, { recursive: true, force: true });
});
async function room() {
  const bridge = createBridge({ host: "codex", shell: { idle: () => false, wakeable: () => false, wake: async () => {} }, conversation: { host: "codex", hostConversationId: crypto.randomUUID(), workspace: { repo: "test", branch: "" } } });
  cleanups.push(() => bridge.dispose());
  const call = async (name: string, params: unknown = {}) => {
    const result = await bridge.tools.find(t => t.name === name)!.call(params);
    assert.equal(result.isError, false, result.text); return result.text;
  };
  const code = /Code: (\S+)/.exec(await call("new_room", { name: "OpenCode test", description: "Synthetic test room" }))![1]!;
  await call("join", { room: code, name: "sender", intro: "Test sender" });
  return { code, call };
}
async function joined() {
  const peer = await room(); const session = await host.session();
  await host.call(session.id, "join", { room: peer.code, name: "receiver", intro: "OpenCode receiver" });
  await until(async () => /alice\/receiver .*online; told now/.test(await peer.call("members")), "online OpenCode");
  return { peer, id: session.id };
}

test("standalone bundle loads eleven native tools and shared commands in the real CLI", async () => {
  const session = await host.session();
  assert.match(await host.call(session.id, "status"), /alice/);
  const tools = host.requests.at(-1)!.tools!.map(tool => tool.function.name).filter(name => name.startsWith("tandry_"));
  assert.deepEqual(tools.sort(), ["history", "inbox", "join", "leave", "login", "members", "new_room", "rename", "send", "status", "update_room"].map(name => `tandry_${name}`).sort());
  const commands = await host.api<Array<{ name: string }>>("GET", "/command");
  assert.deepEqual(commands.filter(c => c.name.startsWith("tandry-")).map(c => c.name).sort(), ["tandry-join", "tandry-leave", "tandry-members", "tandry-new-room", "tandry-status"]);
  assert.match(await host.call(session.id, "inbox", {}, true), /not_in_room/);
  assert.equal(readMarker("opencode", session.id), null);
});

test("idle mail wakes with the same Plan agent, model and variant; body arrives only through inbox", async () => {
  const { peer, id } = await joined();
  const original = await host.api<{ permission?: unknown }>("GET", `/session/${id}`);
  host.steps.push({ tool: "inbox" }, { tool: "send", args: { to: ["alice/sender"], body: "391" } }, { text: "Replied." });
  await peer.call("send", { to: ["alice/receiver"], body: "PRIVATE: calculate 17 * 23", dm: true });
  await until(async () => /391/.test(await peer.call("inbox")), "automatic inbox and reply");
  await until(() => host.idle(id), "idle after reply");
  const notices = await host.notices(id);
  assert.equal(notices.length, 1);
  assert.doesNotMatch(JSON.stringify(notices), /PRIVATE/);
  const messages = await host.messages(id);
  const user = messages.filter(message => message.info.role === "user").at(-1)!.info;
  assert.equal(user.role, "user");
  if (user.role === "user") {
    assert.equal(user.agent, "plan");
    assert.deepEqual(user.model, { providerID: "fixture", modelID: "test", variant: "careful" });
  }
  assert.deepEqual((await host.api<{ permission?: unknown }>("GET", `/session/${id}`)).permission, original.permission);
  assert.match(JSON.stringify(messages.filter(message => message.info.role === "assistant")), /PRIVATE: calculate/);
  assert.equal(await host.call(id, "inbox"), "No new messages.");
  assert.equal((await host.notices(id)).length, 1);
  await host.call(id, "leave");
});

test("a provider failure after wake leaves unread recoverable without repeated automatic prompts", async () => {
  const { peer, id } = await joined();
  host.steps.push({ error: "Synthetic provider failure" });
  await peer.call("send", { to: ["alice/receiver"], body: "Recover after provider error" });
  await until(async () => /Synthetic provider failure/.test(JSON.stringify(await host.messages(id))) && await host.idle(id), "host provider error");
  assert.equal((await host.notices(id)).length, 1);
  assert.match(await host.call(id, "inbox"), /Recover after provider error/);
  assert.equal((await host.notices(id)).length, 1);
  await host.call(id, "leave");
});

test("busy mail attaches once to the next tool result without interrupting the turn", async () => {
  const { peer, id } = await joined();
  let entered = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  host.steps.push(async () => { entered = true; await gate; return { tool: "members" }; }, { tool: "inbox" }, { text: "Done." });
  const prompt = host.prompt(id);
  try {
    await until(() => entered, "busy model");
    await peer.call("send", { to: ["alice/receiver"], body: "Busy delivery" });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await host.notices(id)).length, 0);
  } finally { release(); }
  await prompt;
  const results = (await host.messages(id)).flatMap(m => m.parts).filter(p => p.type === "tool");
  const members = results.filter(p => p.type === "tool" && p.tool === "tandry_members").at(-1)!;
  assert.match(JSON.stringify(members), /Tandry: 1 unread/);
  assert.match(JSON.stringify(results), /Busy delivery/);
  assert.equal((await host.notices(id)).length, 0);
  await host.call(id, "leave");
});

test("mail during the final answer starts one follow-up when idle", async () => {
  const { peer, id } = await joined();
  let entered = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  host.steps.push(async () => { entered = true; await gate; return { text: "Final answer." }; }, { tool: "inbox" }, { text: "Read follow-up." });
  const prompt = host.prompt(id);
  try {
    await until(() => entered, "final answer");
    await peer.call("send", { to: ["alice/receiver"], body: "After final answer" });
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally { release(); }
  await prompt;
  await until(async () => /After final answer/.test(JSON.stringify(await host.messages(id))) && await host.idle(id), "follow-up inbox");
  assert.equal((await host.notices(id)).length, 1);
  await host.call(id, "leave");
});

test("sessions are isolated; forks start unjoined and child sessions cannot use Tandry", async () => {
  const { peer, id } = await joined();
  const other = await host.session();
  await host.call(other.id, "join", { room: peer.code, name: "other", intro: "Another conversation" });
  host.steps.push({ tool: "inbox" }, { text: "Read." });
  await peer.call("send", { to: ["alice/receiver"], body: "Receiver only", dm: true });
  await until(async () => /Receiver only/.test(JSON.stringify(await host.messages(id))) && await host.idle(id), "targeted delivery");
  assert.doesNotMatch(JSON.stringify(await host.messages(other.id)), /Receiver only|Tandry: 1 unread/);
  assert.equal(await host.call(other.id, "inbox"), "No new messages.");
  const fork = await host.api<{ id: string }>("POST", `/session/${id}/fork`, {});
  assert.notEqual(fork.id, id);
  assert.match(await host.call(fork.id, "inbox", {}, true), /not_in_room/);
  assert.equal(readMarker("opencode", fork.id), null);
  const child = await host.session({ parentID: id });
  assert.match(await host.call(child.id, "join", { room: peer.code, name: "child", intro: "Excluded child" }, true), /Only top-level/);
  assert.equal(readMarker("opencode", child.id), null);
  await host.api("DELETE", `/session/${id}`);
  await until(async () => /alice\/receiver .*offline/.test(await peer.call("members")), "deleted session closes link");
  await host.call(other.id, "leave");
});

test("archiving an online session disposes its link", async () => {
  const { peer, id } = await joined();
  await host.api("PATCH", `/session/${id}`, { time: { archived: Date.now() } });
  await until(async () => /alice\/receiver .*offline/.test(await peer.call("members")), "archived session link closed");
});

test("restart stays offline on read-only resume; first prompt reconnects and catches unread", async () => {
  const { peer, id } = await joined();
  await host.close();
  await until(async () => /alice\/receiver .*offline/.test(await peer.call("members")), "shutdown closes link");
  await peer.call("send", { to: ["alice/receiver"], body: "Offline catch-up" });
  host = await startHost(path.join(home, "host"));
  await host.api("GET", `/session/${id}`);
  await host.messages(id);
  assert.match(await peer.call("members"), /alice\/receiver .*offline/);
  assert.equal((await host.notices(id)).length, 0);
  assert.match(await host.call(id, "inbox"), /Offline catch-up/);
  await until(async () => /alice\/receiver .*online; told now/.test(await peer.call("members")), "first prompt reconnects");
  await host.api("POST", "/instance/dispose");
  await until(async () => /alice\/receiver .*offline/.test(await peer.call("members")), "instance dispose");
  assert.deepEqual(host.failures, []);
});
