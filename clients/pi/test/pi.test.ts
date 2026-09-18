import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { createBridge } from "@tandryio/bridge";
import { credentialsPath, readMarker, writeJson } from "@tandryio/bridge/local";
import { startLocalHub, type HubUnderTest } from "../../../packages/hub/testing/start";

// The shipped extension runs inside the real pi SDK and talks to real workerd.
// Only model responses are scripted, using pi's own faux provider.
let hub: HubUnderTest;
let home: string;
const cleanups: (() => Promise<void>)[] = [];
before(async () => {
  hub = await startLocalHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-pi-"));
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
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const response = (name: string, params: Record<string, unknown> = {}) =>
  fauxAssistantMessage(fauxToolCall(`tandry_${name}`, params), { stopReason: "toolUse" });

async function host(options: { manager?: SessionManager; mode?: "rpc" | "print"; extension?: ExtensionFactory; responses?: FauxResponseStep[] } = {}) {
  const dir = fs.mkdtempSync(path.join(home, "host-"));
  const manager = options.manager ?? SessionManager.create(dir, path.join(dir, "sessions"));
  const model = fauxProvider();
  model.setResponses(options.responses ?? []);
  const bundle = path.join(dir, "index.cjs");
  fs.copyFileSync(fileURLToPath(new URL("../dist/index.cjs", import.meta.url)), bundle);
  const runtime = await ModelRuntime.create({ authPath: path.join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(model.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [bundle],
    extensionFactories: options.extension ? [options.extension] : [],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, sessionManager: manager, modelRuntime: runtime, model: model.getModel(),
    settingsManager: settings, resourceLoader: loader, noTools: "builtin",
  });
  const errors: unknown[] = [];
  await session.bindExtensions({ mode: options.mode ?? "rpc", onError: error => { errors.push(error); } });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    assert.deepEqual(errors, []);
  }
  cleanups.push(close);
  const results = () => session.state.messages.filter(m => m.role === "toolResult");
  async function call(name: string, params: Record<string, unknown> = {}, isError = false) {
    model.setResponses([response(name, params), fauxAssistantMessage("Done.")]);
    await session.prompt(`Test ${name}`);
    const result = results().at(-1)!;
    assert.equal(result.toolName, `tandry_${name}`);
    const text = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    assert.equal(result.isError, isError, text);
    return text;
  }
  return { session, manager, model, close, call, results,
    notices: () => session.state.messages.filter(m => m.role === "custom" && m.customType === "tandry"),
  };
}

async function room() {
  const bridge = createBridge({ host: "codex", shell: { idle: () => false, wakeable: () => false, wake: async () => {} },
    conversation: { host: "codex", hostConversationId: crypto.randomUUID(), workspace: { repo: "test", branch: "" } },
  });
  cleanups.push(async () => bridge.dispose());
  const call = async (name: string, params: unknown = {}) => {
    const result = await bridge.tools.find(t => t.name === name)!.call(params);
    assert.equal(result.isError, false, result.text);
    return result.text;
  };
  const code = /Code: (\S+)/.exec(await call("new_room", { name: "pi-test", description: "Pi acceptance" }))![1]!;
  await call("join", { room: code, name: "sender", intro: "Test peer" });
  return { code, call };
}

test("the bundle loads in pi with nine native tools, shared commands and proper tool errors", async () => {
  const pi = await host();
  assert.deepEqual(pi.session.getActiveToolNames().sort(), ["history", "inbox", "join", "leave", "login", "members", "new_room", "send", "status"].map(n => `tandry_${n}`).sort());
  assert.match(await pi.call("status"), /alice/);
  assert.match(await pi.call("inbox", {}, true), /not_in_room/);
  assert.equal(readMarker("pi", pi.manager.getSessionId()), null);
  pi.model.setResponses([response("status"), fauxAssistantMessage("Done.")]);
  await pi.session.prompt("/tandry-status");
  await until(() => pi.session.isIdle && pi.results().at(-1)?.toolName === "tandry_status", "slash command");
  assert.match(JSON.stringify(pi.session.state.messages), /Call the Tandry status tool/);
  await pi.close();
});

test("the actual bundled pi CLI loads the standalone extension through RPC", { timeout: 15_000 }, async t => {
  const dir = fs.mkdtempSync(path.join(home, "cli-"));
  const bundle = path.join(dir, "index.cjs");
  fs.copyFileSync(fileURLToPath(new URL("../dist/index.cjs", import.meta.url)), bundle);
  const cli = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js", import.meta.url));
  const child = spawn(process.execPath, [cli, "--mode", "rpc", "--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes", "--extension", bundle], {
    cwd: dir, env: { ...process.env, PI_CODING_AGENT_DIR: dir, PI_TELEMETRY: "false" }, stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  const lines = createInterface({ input: child.stdout });
  const responses: { id?: string; success?: boolean; data?: { commands: { name: string }[] } }[] = [];
  lines.on("line", line => { try { responses.push(JSON.parse(line)); } catch {} });
  child.stdin.write(JSON.stringify({ id: "commands", type: "get_commands" }) + "\n");
  await until(() => responses.some(r => r.id === "commands") || child.exitCode !== null, "CLI RPC startup");
  const result = responses.find(r => r.id === "commands");
  assert.equal(result?.success, true, stderr);
  assert.deepEqual(result!.data!.commands.filter(c => c.name.startsWith("tandry-")).map(c => c.name).sort(),
    ["tandry-join", "tandry-leave", "tandry-members", "tandry-new-room", "tandry-status"]);
});

test("idle mail starts a real pi turn; only inbox delivers the body and a reply advances read state", async () => {
  const sender = await room();
  const pi = await host();
  assert.match(await pi.call("join", { room: sender.code, name: "receiver", intro: "Pi receiver" }), /Joined/);
  await until(async () => /alice\/receiver .*live; told now/.test(await sender.call("members")), "wakeable pi link");
  pi.model.setResponses([response("inbox"), response("send", { to: ["alice/sender"], body: "391" }), fauxAssistantMessage("Replied.")]);
  await sender.call("send", { to: ["alice/receiver"], body: "PRIVATE: compute 17*23", dm: true });
  await until(() => pi.session.isIdle && pi.results().some(r => r.toolName === "tandry_send"), "automatic inbox and reply");
  assert.equal(pi.notices().length, 1);
  assert.doesNotMatch(JSON.stringify(pi.notices()), /PRIVATE/);
  assert.match(JSON.stringify(pi.results()), /PRIVATE: compute 17\*23/);
  assert.match(await sender.call("inbox"), /391/);
  assert.equal(await pi.call("inbox"), "No new messages.");
  assert.equal(pi.notices().length, 1, "unchanged unread state is not announced again");
  await pi.close();
});

test("busy mail is announced once at the next tool boundary, preserving that tool's result", async () => {
  const sender = await room();
  const pi = await host();
  await pi.call("join", { room: sender.code, name: "receiver", intro: "Busy pi" });
  await until(async () => /alice\/receiver .*live; told now/.test(await sender.call("members")), "link");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  pi.model.setResponses([
    async () => { entered = true; await gate; return response("members"); },
    response("inbox"), fauxAssistantMessage("Finished."),
  ]);
  const prompt = pi.session.prompt("Work until released.");
  await until(() => entered, "busy model");
  await sender.call("send", { to: ["alice/receiver"], body: "busy message" });
  // Give the WebSocket frame its own event-loop turn before releasing the model.
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(pi.notices().length, 0);
  release();
  await prompt;
  const members = pi.results().filter(r => r.toolName === "tandry_members").at(-1)!;
  assert.match(JSON.stringify(members.content), /alice\/sender/);
  assert.match(JSON.stringify(members.content), /Tandry: 1 unread/);
  assert.match(JSON.stringify(pi.results().at(-1)), /busy message/);
  assert.equal(pi.notices().length, 0, "tool boundary and idle wake share deduplication");
  await pi.close();
});

test("resuming the same session wakes without a prompt; a fork has its own identity and no membership", async () => {
  const sender = await room();
  const pi = await host();
  await pi.call("join", { room: sender.code, name: "receiver", intro: "Resumable pi" });
  const id = pi.manager.getSessionId();
  const file = pi.manager.getSessionFile()!;
  await pi.close();
  await until(async () => /alice\/receiver .*dormant/.test(await sender.call("members")), "dormant receiver");
  await sender.call("send", { to: ["alice/receiver"], body: "offline catch-up" });
  const resumed = await host({ manager: SessionManager.open(file), responses: [response("inbox"), fauxAssistantMessage("Caught up.")] });
  assert.equal(resumed.manager.getSessionId(), id);
  await until(() => resumed.session.isIdle && resumed.notices().length === 1, "no-input resume wake");
  assert.match(JSON.stringify(resumed.results().at(-1)), /offline catch-up/);
  await resumed.close();
  const fork = await host({ manager: SessionManager.forkFrom(file, home, path.join(home, "fork")) });
  assert.notEqual(fork.manager.getSessionId(), id);
  assert.match(await fork.call("inbox", {}, true), /not_in_room/);
  assert.equal(readMarker("pi", fork.manager.getSessionId()), null);
  assert.equal(fork.notices().length, 1, "the inherited transcript keeps its old notice but receives no new one");
  await fork.close();
});

test("mail arriving during a final answer queues a follow-up even without another tool call", async () => {
  const sender = await room();
  const pi = await host();
  await pi.call("join", { room: sender.code, name: "receiver", intro: "Final answer pi" });
  await until(async () => /alice\/receiver .*live; told now/.test(await sender.call("members")), "link");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  pi.model.setResponses([
    async () => { entered = true; await gate; return fauxAssistantMessage("Final answer."); },
    response("inbox"), fauxAssistantMessage("Follow-up done."),
  ]);
  const prompt = pi.session.prompt("Finish without tools.");
  await until(() => entered, "final answer in progress");
  await sender.call("send", { to: ["alice/receiver"], body: "after final answer" });
  await new Promise(resolve => setTimeout(resolve, 100));
  release();
  await prompt;
  await until(() => pi.session.isIdle && pi.results().at(-1)?.toolName === "tandry_inbox", "follow-up inbox");
  assert.equal(pi.notices().length, 1);
  assert.match(JSON.stringify(pi.results().at(-1)), /after final answer/);
  await pi.close();
});

test("print mode reports next-turn delivery; leaving removes the membership", async () => {
  const sender = await room();
  const pi = await host({ mode: "print" });
  await pi.call("join", { room: sender.code, name: "receiver", intro: "One-shot pi" });
  await until(async () => /alice\/receiver .*live, seen on next turn/.test(await sender.call("members")), "non-wakeable print session");
  await sender.call("send", { to: ["alice/receiver"], body: "next prompt" });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(pi.notices().length, 0);
  assert.match(await pi.call("inbox"), /next prompt/);
  assert.equal(pi.notices().length, 1);
  await pi.call("leave");
  assert.equal(readMarker("pi", pi.manager.getSessionId()), null);
  await pi.call("inbox", {}, true);
  await pi.close();
});
