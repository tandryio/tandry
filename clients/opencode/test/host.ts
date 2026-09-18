import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Session, Message, Part } from "@opencode-ai/sdk";

export async function until(check: () => boolean | Promise<boolean>, what: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
export type Step = { tool: string; args?: Record<string, unknown> } | { text: string } | { error: string };
export type ModelRequest = { messages: Array<{ role: string; content: unknown; tool_calls?: unknown[] }>; tools?: Array<{ function: { name: string; parameters: unknown } }> };

/** A real CLI/server and plugin; only the OpenAI-compatible model is scripted. */
export async function startHost(dir: string, provider?: { baseURL: string; apiKey: string; model: string; npm?: string }) {
  fs.mkdirSync(dir, { recursive: true });
  const bundle = path.join(dir, "tandry.mjs");
  fs.copyFileSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)), bundle);
  const configHome = path.join(dir, "config");
  const configDir = path.join(configHome, "opencode");
  fs.mkdirSync(path.join(configDir, "node_modules", "@opencode-ai"), { recursive: true });
  const pluginPackage = fs.realpathSync(fileURLToPath(new URL("../node_modules/@opencode-ai/plugin", import.meta.url)));
  const linkedPlugin = path.join(configDir, "node_modules", "@opencode-ai", "plugin");
  if (!fs.existsSync(linkedPlugin)) fs.symlinkSync(pluginPackage, linkedPlugin, "dir");
  // Satisfy OpenCode's configuration dependency check without registry access.
  const dependencies = { "@opencode-ai/plugin": "1.18.30" };
  fs.writeFileSync(path.join(configDir, "package.json"), JSON.stringify({ dependencies }));
  fs.writeFileSync(path.join(configDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies } } }));
  const steps: Array<Step | (() => Promise<Step>)> = [];
  const requests: ModelRequest[] = [];
  const failures: string[] = [];
  const model = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      const next = steps.shift() ?? { text: "Done." };
      const step = typeof next === "function" ? await next() : next;
      if ("error" in step) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: step.error, type: "invalid_request_error" } }));
        return;
      }
      const delta = "tool" in step
        ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${crypto.randomUUID()}`, type: "function", function: { name: `tandry_${step.tool}`, arguments: JSON.stringify(step.args ?? {}) } }] }
        : { role: "assistant", content: step.text };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.end(frame(delta, null) + frame({}, "tool" in step ? "tool_calls" : "stop") + "data: [DONE]\n\n");
    } catch (error) { failures.push(String(error)); res.writeHead(500); res.end("Scripted model failure"); }
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  const address = model.address();
  assert.ok(address && typeof address !== "string");
  const providerConfig = provider ?? { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "synthetic", model: "test" };
  const config = {
    plugin: [pathToFileURL(bundle).href],
    model: `fixture/${providerConfig.model}`, small_model: `fixture/${providerConfig.model}`,
    provider: { fixture: { npm: providerConfig.npm ?? "@ai-sdk/openai-compatible", name: "Test provider", options: { baseURL: providerConfig.baseURL, apiKey: providerConfig.apiKey }, models: { [providerConfig.model]: { name: "Test", limit: { context: 32768, output: 4096 }, variants: { careful: {} } } } } },
    agent: { title: { disable: true }, summary: { disable: true }, compaction: { disable: true } },
    permission: { "*": "deny", "tandry_*": "allow" },
    share: "disabled", snapshot: false,
  };
  const executable = fileURLToPath(new URL("../node_modules/opencode-ai/bin/opencode.exe", import.meta.url));
  const child = spawn(executable, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: dir,
    env: {
      ...process.env, HOME: dir, XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: path.join(dir, "data"), XDG_CACHE_HOME: path.join(dir, "cache"), XDG_STATE_HOME: path.join(dir, "state"),
      OPENCODE_CONFIG: "", OPENCODE_CONFIG_DIR: "", OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_AUTOUPDATE: "true", npm_config_offline: "true",
      OPENCODE_SERVER_PASSWORD: "", OPENCODE_SERVER_USERNAME: "",
      NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1",
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let url: string | undefined;
  child.stdout.on("data", data => { output += data; url = /listening on (http:\/\/\S+)/.exec(output)?.[1]; });
  child.stderr.on("data", data => { output += data; });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited; clearTimeout(timer);
    }
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
  }
  try { await until(() => { if (child.exitCode !== null) throw new Error(output); return !!url; }, "OpenCode server", 30_000); }
  catch (error) { await close(); throw error; }
  async function api<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const response = await fetch(url + endpoint, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `${method} ${endpoint}: ${await response.clone().text()}\n${output}`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  const messages = (id: string) => api<Array<{ info: Message; parts: Part[] }>>("GET", `/session/${id}/message`);
  const idle = async (id: string) => !(await api<Record<string, unknown>>("GET", "/session/status"))[id];
  const prompt = (id: string, text = "Run the next test step.", options: Record<string, unknown> = {}) => api<{ info: Message; parts: Part[] }>("POST", `/session/${id}/message`, { agent: "plan", model: { providerID: "fixture", modelID: providerConfig.model }, variant: "careful", parts: [{ type: "text", text }], ...options });
  async function call(id: string, name: string, args: Record<string, unknown> = {}, error = false) {
    steps.push({ tool: name, args }, { text: "Done." });
    await prompt(id);
    const parts = (await messages(id)).flatMap(message => message.parts);
    const result = parts.filter(part => part.type === "tool" && part.tool === `tandry_${name}`).at(-1);
    assert.ok(result?.type === "tool", `${name} did not run: ${JSON.stringify(parts)} ${output}`);
    assert.equal(result.state.status, error ? "error" : "completed", JSON.stringify(result));
    return result.state.status === "completed" ? result.state.output : result.state.status === "error" ? result.state.error : "";
  }
  return { dir, child, close, api, messages, idle, prompt, call, steps, requests, failures, diagnostics: () => output,
    session: (body: Record<string, unknown> = {}) => api<Session>("POST", "/session", { title: "Tandry test", ...body }),
    notices: async (id: string) => (await messages(id)).flatMap(message => message.parts).filter(part => part.type === "text" && part.synthetic && part.text.startsWith("Tandry:")),
  };
}
