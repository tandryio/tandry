import { spawn } from 'node:child_process';
import { access, readFile, realpath, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [host, ...rest] = process.argv.slice(2);
const hosts = ['claude', 'codex', 'pi', 'opencode', 'dsh'];
const args = rest[0] === '--' ? rest.slice(1) : rest;
const env = {
  ...process.env,
  TANDRY_HUB: process.env.TANDRY_HUB || 'http://127.0.0.1:8799',
  TANDRY_HOME: process.env.TANDRY_HOME || join(homedir(), '.tandry-dev'),
};
let child;
let interrupted = false;
let dshPatchDirectory;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    child?.kill(signal);
  });
}

function run(command, argv, capture = false) {
  if (interrupted) throw new Error('Launch canceled.');
  return new Promise((resolvePromise, reject) => {
    child = spawn(command, argv, {
      cwd: root, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';
    child.stdout?.on('data', data => { output += data; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (code === 0) resolvePromise(output);
      else {
        const error = new Error(`${command} exited (${signal || code})`);
        error.exitCode = code || (signal === 'SIGINT' ? 130 : 1);
        reject(error);
      }
    });
  });
}

async function executable(command) {
  for (const directory of (env.PATH || '').split(delimiter)) {
    try {
      await access(join(directory, command), constants.X_OK);
      return;
    } catch {}
  }
  throw new Error(`Cannot find ${command}. Install the host CLI and add it to PATH.`);
}

async function prepareCodex() {
  const marketplaceRoot = join(root, '.local/marketplace');
  const marketplace = JSON.parse(await readFile(join(marketplaceRoot, '.agents/plugins/marketplace.json'), 'utf8'));
  const name = marketplace.name;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid marketplace name.');
  const { marketplaces } = JSON.parse(await run('codex', ['plugin', 'marketplace', 'list', '--json'], true));
  const existing = marketplaces.find(item => item.name === name);
  if (existing && await realpath(existing.root) !== await realpath(marketplaceRoot)) {
    throw new Error(`${name} points to another directory. Run codex plugin marketplace remove ${name}, then try again.`);
  }
  if (!existing) await run('codex', ['plugin', 'marketplace', 'add', marketplaceRoot]);
  const { installed } = JSON.parse(await run('codex', ['plugin', 'list', '--json'], true));
  const id = `tandry@${name}`;
  // Removing the installed copy clears the cache without editing source versions.
  if (installed.some(item => item.pluginId === id)) await run('codex', ['plugin', 'remove', id]);
  await run('codex', ['plugin', 'add', id]);
  console.log('Codex refreshed the local plugin. On first use, review and trust its hooks in /hooks.');
}

try {
  if (!host || host === '--help' || host === '-h') {
    console.log('Usage: pnpm agent <claude|codex|pi|opencode|dsh> [host arguments...]\nRun pnpm dev first. The default Hub is local; data is stored in ~/.tandry-dev.\nExample: pnpm agent claude --resume');
  } else {
    if (!hosts.includes(host)) throw new Error(`Unsupported host ${host}. Choose from: ${hosts.join(', ')}`);
    await executable(host);
    const health = new URL('/health', env.TANDRY_HUB);
    try {
      const response = await fetch(health, { signal: AbortSignal.timeout(3000) });
      if (!response.ok || (await response.json()).ok !== true) throw new Error();
    } catch {
      throw new Error(`Cannot connect to Hub ${env.TANDRY_HUB}. Run pnpm dev in another terminal first.`);
    }
    console.log(`Local ${host} plugin → ${env.TANDRY_HUB}\nData directory: ${env.TANDRY_HOME}\nBuilding plugins…`);
    await run('pnpm', ['build']);
    const plugin = join(root, 'clients', host);
    let launchArgs = args;
    if (host === 'claude') launchArgs = ['--plugin-dir', plugin, ...args];
    if (host === 'pi') launchArgs = ['--extension', join(plugin, 'dist/index.cjs'), ...args];
    if (host === 'opencode') {
      const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}');
      config.plugin = [...(config.plugin || []), pathToFileURL(join(plugin, 'dist/index.js')).href];
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
    }
    if (host === 'dsh') {
      dshPatchDirectory = await mkdtemp(join(tmpdir(), 'tandry-dsh-launch-'));
      const patch = join(dshPatchDirectory, 'cordis.patch.yml');
      const oneShot = args.some((arg, i) => arg === '--profile=headless' || (arg === '--profile' && args[i + 1] === 'headless'));
      await writeFile(patch, JSON.stringify([{ insert: [{ id: 'tandry', name: pathToFileURL(join(plugin, 'dist/index.js')).href, config: { wakeable: !oneShot } }] }]));
      launchArgs = ['--patch', patch, ...args];
    }
    if (host === 'codex') await prepareCodex();
    await run(host, launchArgs);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted ? process.exitCode : (error.exitCode || 1);
}

finally {
  if (dshPatchDirectory) await rm(dshPatchDirectory, { recursive: true, force: true });
}
