import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const hubDir = fileURLToPath(new URL("../", import.meta.url));

export interface TestAccount {
  id: string;
  handle: string | null;
  token: string;
}

export interface HubUnderTest {
  baseUrl: string;
  accounts: { alice: TestAccount; bob: TestAccount; nohandle: TestAccount };
  stop(): Promise<void>;
}

export interface StartOptions {
  /** The Worker entry. Defaults to the self-hosted Hub; tandry-cloud passes its own composition. */
  main?: string;
  /** Extra D1 migration directories, applied after the Hub's own. */
  migrations?: string[];
  vars?: Record<string, string>;
  /** Where wrangler is installed. Defaults to the Hub package. */
  cwd?: string;
}

const account = (name: string, handle: string | null): TestAccount =>
  ({ id: `test-${name}`, handle, token: `test-${name}-token-long-enough-for-better-auth` });

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  server.close();
  await once(server, "close");
  return port;
}

/** A real local workerd with its own temporary D1 and Durable Object state, seeded with synthetic accounts. */
export async function startLocalHub(options: StartOptions = {}): Promise<HubUnderTest> {
  const cwd = options.cwd ?? hubDir;
  const wrangler = path.join(cwd, "node_modules/wrangler/bin/wrangler.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-hub-test-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const accounts = { alice: account("alice", "alice"), bob: account("bob", "bob"), nohandle: account("nohandle", null) };

  const config = path.join(root, "wrangler.json");
  fs.writeFileSync(config, JSON.stringify({
    name: "tandry-hub-test",
    main: options.main ?? path.join(hubDir, "src/index.ts"),
    compatibility_date: "2026-09-13",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [{ binding: "AUTH_DB", database_name: "tandry-test", database_id: "00000000-0000-0000-0000-000000000001" }],
    r2_buckets: [{ binding: "AVATARS", bucket_name: "tandry-avatars-test" }],
    durable_objects: { bindings: [{ name: "ROOM", class_name: "RoomDO" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["RoomDO"] }],
    vars: {
      BETTER_AUTH_URL: baseUrl,
      BETTER_AUTH_SECRET: "only-for-local-tests-not-a-production-secret-1234",
      ...options.vars,
    },
  }));

  const now = Date.now();
  const directories = [path.join(hubDir, "migrations"), ...(options.migrations ?? [])];
  let sql = directories.flatMap((directory) => fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))).join("\n");
  for (const user of Object.values(accounts))
    sql += `\nINSERT INTO user VALUES ('${user.id}','${user.id}',${user.handle ? `'${user.handle}'` : "NULL"},'${user.id}@example.test',1,NULL,${now},${now});`
      + `\nINSERT INTO session VALUES ('${user.id}-session','${user.token}','${user.id}',${now + 86_400_000},${now},${now},NULL,'tandry/test');`;
  const seed = path.join(root, "seed.sql");
  fs.writeFileSync(seed, sql, { mode: 0o600 });
  const state = path.join(root, "state");
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  await run(process.execPath, [wrangler, "d1", "execute", "AUTH_DB", "--local", "--config", config, "--persist-to", state, "--file", seed], { cwd, env, maxBuffer: 4 * 1024 * 1024 });

  let output = "";
  const worker: ChildProcess = spawn(process.execPath, [wrangler, "dev", "--local", "--config", config, "--port", String(port),
    "--inspector-port", "0", "--persist-to", state, "--show-interactive-dev-session=false"], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (data) => { output = (output + data).slice(-12_000); });

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (worker.exitCode !== null) throw new Error(`Local Hub exited:\n${output}`);
    if (await fetch(`${baseUrl}/health`).then((response) => response.ok, () => false)) break;
    if (Date.now() > deadline) throw new Error(`Local Hub did not start:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    baseUrl,
    accounts,
    async stop() {
      if (worker.exitCode === null) {
        const exited = once(worker, "exit");
        process.kill(-worker.pid!, "SIGTERM");
        await exited;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
