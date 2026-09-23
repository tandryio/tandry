import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import Agents, { type Agent, type CreateAgentOptions } from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import Llm, { LlmAdapter, createUserMessage, ToolCallId, type GenerateOptions, type StreamChunk } from "@deepseek-ai/dsh-llm";
import Sessions, { SessionId } from "@deepseek-ai/dsh-session";
import Projections from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import Tools from "@deepseek-ai/dsh-tools";
import Skills from "@deepseek-ai/dsh-skill";
import Persistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import { createBridge } from "@tandryio/bridge";
import { credentialsPath, readMarker, writeJson } from "@tandryio/bridge/local";
import { startLocalHub, type HubUnderTest } from "../../../packages/hub/testing/start";

let hub: HubUnderTest;
let home: string;
const cleanups: (() => void | Promise<void>)[] = [];
before(async () => {
  hub = await startLocalHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-dsh-"));
  process.env.TANDRY_HOME = home;
  process.env.TANDRY_HUB = hub.baseUrl;
  writeJson(credentialsPath(), { hub: hub.baseUrl, token: hub.accounts.alice.token, account: { id: hub.accounts.alice.id, handle: "alice" } });
});
after(async () => {
  for (const close of cleanups.reverse()) await close();
  await hub?.stop();
  fs.rmSync(home, { recursive: true, force: true });
});
async function until(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
type Response = { name: string; args?: Record<string, unknown> } | string;
class Model extends LlmAdapter {
  steps: (Response | (() => Promise<Response>))[] = [];
  requests: GenerateOptions[] = [];
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    const next = this.steps.shift() ?? "Done.";
    const response = typeof next === "function" ? await next() : next;
    if (typeof response === "string") {
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: response };
      yield { type: "block-end", index: 0, block: { type: "text", text: response } };
    } else {
      const id = ToolCallId(crypto.randomUUID());
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield { type: "tool-call-delta", index: 0, id, name: `tandry_${response.name}`, argumentsDelta: JSON.stringify(response.args ?? {}) };
      yield { type: "block-end", index: 0, block: { type: "tool-call", id, name: `tandry_${response.name}`, arguments: JSON.stringify(response.args ?? {}) } };
    }
    yield { type: "finish", reason: { kind: "stop" } };
  }
}
async function host(wakeable = true) {
  const dir = fs.mkdtempSync(path.join(home, "host-"));
  const bundle = path.join(dir, "tandry.mjs");
  fs.copyFileSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)), bundle);
  const plugin = await import(pathToFileURL(bundle).href);
  const ctx = new Context();
  await ctx.plugin(Sessions).await();
  await ctx.plugin(Projections).await();
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await();
  await ctx.plugin(Llm).await();
  await ctx.plugin(Tools).await();
  await ctx.plugin(Skills).await();
  await ctx.plugin(Agents).await();
  await ctx.plugin(Persistence, { root: path.join(dir, "sessions"), compression: "none" }).await();
  await ctx.plugin(AgentLoop, { agents: [] }).await();
  const mounted = ctx.plugin(plugin, { wakeable });
  await mounted.await();
  const model = new Model();
  ctx.llm.registerAdapter(["fixture"], model);
  cleanups.push(() => ctx.fiber.dispose());
  async function open(options: Partial<CreateAgentOptions> = {}, resume = false) {
    const sessionId = options.sessionId ?? SessionId(crypto.randomUUID());
    const config = { sessionId, agentOptions: { provider: "fixture", model: "scripted" }, ...options };
    const handle = resume ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: config.agentOptions }) : await ctx.agents.create({ ...config, meta: { cwd: dir, ...options.meta } });
    const agent = handle.agent;
    function results() { return agent.session.deriveMessages().flatMap(m => m.content).filter(c => c.type === "tool-result"); }
    async function prompt(text: string) {
      agent.followup(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
      await agent.whenIdle();
    }
    async function call(name: string, args: Record<string, unknown> = {}, error = false) {
      model.steps = [{ name, args }, "Done."];
      await prompt(`Test ${name}`);
      const result = results().at(-1)!;
      assert.ok(result, JSON.stringify(agent.session.snapshotEvents()));
      assert.equal(Boolean(result.isError), error, JSON.stringify(result));
      return JSON.stringify(result.content);
    }
    return { agent, close: () => handle.dispose(), call, prompt, results,
      notices: () => agent.session.deriveMessages().filter(m => m.source.kind === "plugin" && m.source.plugin === "tandry"),
    };
  }
  return { ctx, model, open, mounted };
}
async function room() {
  const bridge = createBridge({ host: "codex", shell: { idle: () => false, wakeable: () => false, wake: async () => {} }, conversation: { host: "codex", hostConversationId: crypto.randomUUID(), workspace: { repo: "test", branch: "" } } });
  cleanups.push(() => bridge.dispose());
  const call = async (name: string, params: unknown = {}) => {
    const result = await bridge.tools.find(t => t.name === name)!.call(params);
    assert.equal(result.isError, false, result.text);
    return result.text;
  };
  const code = /Code: (\S+)/.exec(await call("new_room", { name: "dsh-test", description: "Dsh acceptance" }))![1]!;
  await call("join", { room: code, name: "sender", intro: "Test peer" });
  return { code, call };
}

test("standalone bundle registers native tools and shared skills in the real dsh runtime", async () => {
  const dsh = await host();
  const receiver = await dsh.open();
  assert.equal(dsh.ctx.tools.schemas(receiver.agent).filter(t => t.name.startsWith("tandry_")).length, 11);
  assert.match(await receiver.call("status"), /alice/);
  assert.match(await receiver.call("inbox", {}, true), /not_in_room/);
  assert.equal(readMarker("dsh", receiver.agent.id), null);
  assert.equal((await dsh.ctx.skills.list()).filter(s => s.name.startsWith("tandry-")).length, 5);
  await receiver.close();
});

test("idle mail wakes repeatedly, preserves model selection and delivers bodies only through inbox", async () => {
  const sender = await room();
  const dsh = await host();
  const receiver = await dsh.open();
  await receiver.call("join", { room: sender.code, name: "receiver", intro: "Dsh receiver" });
  await until(async () => /alice\/receiver .*online; told now/.test(await sender.call("members")), "wakeable link");
  for (let i = 0; i < 2; i++) {
    dsh.model.steps = [{ name: "inbox" }, { name: "send", args: { to: ["alice/sender"], body: `391-${i}` } }, "Done."];
    await sender.call("send", { to: ["alice/receiver"], body: `PRIVATE-${i}: compute 17*23`, dm: true });
    await until(() => receiver.agent.status === "idle" && receiver.notices().length === i + 1 && receiver.results().some(r => JSON.stringify(r).includes(`PRIVATE-${i}`)), "automatic reply");
    assert.match(await sender.call("inbox"), new RegExp(`391-${i}`));
    assert.doesNotMatch(JSON.stringify(receiver.notices()), /PRIVATE/);
    assert.match(await receiver.call("inbox"), /No new messages/);
  }
  assert.ok(dsh.model.requests.every(r => r.provider === "fixture" && r.model === "scripted"));
  await receiver.close();
});

test("busy mail enters once at the tool boundary and preserves the tool result", async () => {
  const sender = await room();
  const dsh = await host();
  const receiver = await dsh.open();
  await receiver.call("join", { room: sender.code, name: "receiver", intro: "Busy dsh" });
  await until(async () => /alice\/receiver .*online; told now/.test(await sender.call("members")), "link");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  dsh.model.steps = [async () => { entered = true; await gate; return { name: "members" }; }, { name: "inbox" }, "Done."];
  const prompt = receiver.prompt("Wait for work.");
  await until(() => entered, "model request");
  await sender.call("send", { to: ["alice/receiver"], body: "busy mail" });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(receiver.notices().length, 0);
  release();
  await prompt;
  assert.match(JSON.stringify(receiver.results()), /alice\/sender/);
  assert.match(JSON.stringify(receiver.results()), /busy mail/);
  assert.equal(receiver.notices().length, 1);
  await receiver.close();
});

test("mail during a final answer gets one follow-up at true idle", async () => {
  const sender = await room();
  const dsh = await host();
  const receiver = await dsh.open();
  await receiver.call("join", { room: sender.code, name: "receiver", intro: "Final answer dsh" });
  await until(async () => /alice\/receiver .*online; told now/.test(await sender.call("members")), "link");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  dsh.model.steps = [async () => { entered = true; await gate; return "Finished."; }, { name: "inbox" }, "Done."];
  const prompt = receiver.prompt("Finish without tools.");
  await until(() => entered, "model request");
  await sender.call("send", { to: ["alice/receiver"], body: "final-answer mail" });
  await new Promise(resolve => setTimeout(resolve, 100));
  release();
  await prompt;
  await until(() => receiver.agent.status === "idle" && JSON.stringify(receiver.results()).includes("final-answer mail"), "follow-up");
  assert.equal(receiver.notices().length, 1);
  await receiver.close();
});

test("persisted resume catches up without input; forks and runtime children never inherit membership", async () => {
  const sender = await room();
  const dsh = await host();
  const receiver = await dsh.open();
  await receiver.call("join", { room: sender.code, name: "receiver", intro: "Resumable dsh" });
  const id = receiver.agent.id;
  const seed = receiver.agent.session.snapshotEvents();
  await receiver.close();
  await until(async () => /alice\/receiver .*offline/.test(await sender.call("members")), "offline");
  await sender.call("send", { to: ["alice/receiver"], body: "offline catch-up" });
  dsh.model.steps = [{ name: "inbox" }, "Caught up."];
  const resumed = await dsh.open({ sessionId: id }, true);
  await until(() => resumed.agent.status === "idle" && JSON.stringify(resumed.results()).includes("offline catch-up"), "resume wake");
  const fork = await dsh.open({ seed, meta: { parentSession: id, isSeeded: true }, inheritedEventCount: receiver.agent.session.seq });
  assert.match(await fork.call("inbox", {}, true), /not_in_room/);
  assert.equal(readMarker("dsh", fork.agent.id), null);
  const child = await dsh.open({ parentAgent: resumed.agent, meta: { origin: "subagent", parentSession: id } });
  assert.match(await child.call("join", { room: sender.code, name: "child", intro: "Child" }, true), /top-level/);
  assert.equal(readMarker("dsh", child.agent.id), null);
  await child.close();
  await fork.close();
  await resumed.close();
});

test("concurrent roots remain isolated and plugin disposal closes all links", async () => {
  const sender = await room();
  const dsh = await host();
  const a = await dsh.open();
  const b = await dsh.open();
  await a.call("join", { room: sender.code, name: "a", intro: "A" });
  await b.call("join", { room: sender.code, name: "b", intro: "B" });
  await until(async () => /alice\/a .*online; told now/.test(await sender.call("members")) && /alice\/b .*online; told now/.test(await sender.call("members")), "both roots");
  dsh.model.steps = [{ name: "inbox" }, "Done."];
  await sender.call("send", { to: ["alice/a"], body: "only-a", dm: true });
  await until(() => a.agent.status === "idle" && JSON.stringify(a.results()).includes("only-a"), "a inbox");
  assert.equal(b.notices().length, 0);
  assert.doesNotMatch(await b.call("inbox"), /only-a/);
  await dsh.mounted.dispose();
  await until(async () => /alice\/a .*offline/.test(await sender.call("members")) && /alice\/b .*offline/.test(await sender.call("members")), "disposed links");
  await a.close();
  await b.close();
});

test("non-wakeable mode is offline to senders and leave removes the marker", async () => {
  const sender = await room();
  const dsh = await host(false);
  const receiver = await dsh.open();
  await receiver.call("join", { room: sender.code, name: "receiver", intro: "One-shot dsh" });
  await until(async () => /alice\/receiver .*offline/.test(await sender.call("members")), "non-wakeable link offline");
  await sender.call("send", { to: ["alice/receiver"], body: "next-turn mail" });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(receiver.notices().length, 0);
  dsh.model.steps = ["No tools needed."];
  await receiver.prompt("Continue without tools.");
  assert.equal(receiver.notices().length, 1, "next-turn notice does not require a tool call");
  assert.match(await receiver.call("inbox"), /next-turn mail/);
  await receiver.call("leave");
  assert.equal(readMarker("dsh", receiver.agent.id), null);
  await receiver.close();
});

test("a model failure after wake leaves unread recoverable without repeated turns", async () => {
  const sender = await room();
  const dsh = await host();
  const receiver = await dsh.open();
  await receiver.call("join", { room: sender.code, name: "receiver", intro: "Provider failure" });
  await until(async () => /alice\/receiver .*online; told now/.test(await sender.call("members")), "link");
  dsh.model.steps = [async () => { throw new Error("Synthetic provider failure"); }];
  const before = dsh.model.requests.length;
  await sender.call("send", { to: ["alice/receiver"], body: "recoverable mail" });
  await until(() => receiver.agent.status === "idle" && dsh.model.requests.length > before, "failed wake turn");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(dsh.model.requests.length, before + 1);
  assert.match(await sender.call("members"), /alice\/receiver .*1 of your messages unread/);
  assert.match(await receiver.call("inbox"), /recoverable mail/);
  await receiver.close();
});
