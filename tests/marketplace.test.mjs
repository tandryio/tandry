import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import readline from 'node:readline';
import { marketplace } from '../scripts/package-plugins.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tandry-marketplace-test-'));
const destination = path.join(temporary, 'marketplace');
fs.cpSync(marketplace, destination, { recursive: true });
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const read = file => JSON.parse(fs.readFileSync(path.join(destination, file), 'utf8'));

test('marketplace catalogs resolve to complete standalone plugin packages', () => {
  const claude = read('.claude-plugin/marketplace.json');
  const codex = read('.agents/plugins/marketplace.json');
  assert.equal(claude.name, 'tandry-marketplace');
  assert.equal(codex.name, claude.name);
  assert.ok(fs.existsSync(path.join(destination, claude.plugins[0].source, 'dist/main.cjs')));
  assert.ok(fs.existsSync(path.join(destination, claude.plugins[0].source, 'dist/hook.cjs')));
  assert.ok(fs.existsSync(path.join(destination, codex.plugins[0].source.path, 'dist/tandry.cjs')));
  assert.deepEqual(fs.readdirSync(path.join(destination, 'clients')).sort(), ['claude', 'codex', 'dsh', 'opencode', 'pi']);
  assert.deepEqual(read('clients/pi/package.json').pi.extensions, ['./dist/index.cjs']);
  assert.ok(fs.existsSync(path.join(destination, 'clients/pi/dist/index.cjs')));
  assert.equal(read('clients/dsh/package.json').main, './dist/index.js');
  assert.ok(fs.existsSync(path.join(destination, 'clients/dsh/cordis.patch.yml')));
  assert.equal(read('clients/dsh/package.json').dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(read('clients/opencode/package.json').main, './dist/index.js');
  assert.ok(fs.existsSync(path.join(destination, 'clients/opencode/dist/index.js')));
  for (const host of fs.readdirSync(path.join(destination, 'clients'))) {
    const pkg = read(`clients/${host}/package.json`);
    assert.equal(pkg.version, read('release.json').versions[host]);
    if (process.env.RELEASE_VERSION) assert.equal(pkg.version, process.env.RELEASE_VERSION);
    assert.equal(pkg.scripts, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.dependencies, undefined, 'bundled plugins need no package installation');
    assert.ok(fs.existsSync(path.join(destination, 'clients', host, 'LICENSE')));
    assert.ok(fs.existsSync(path.join(destination, 'clients', host, 'THIRD_PARTY_NOTICES.md')));
    for (const version of Object.values({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      assert.doesNotMatch(version, /^(workspace:|file:|link:)/);
    }
  }
  for (const [host, manifest] of [['claude', '.claude-plugin/plugin.json'], ['codex', '.codex-plugin/plugin.json']]) {
    assert.equal(read(`clients/${host}/${manifest}`).version, read(`clients/${host}/package.json`).version);
  }
  assert.match(read('release.json').source.commit, /^[0-9a-f]{40}$/);
  assert.equal(read('release.json').source.repository, 'https://github.com/tandryio/tandry');
});

test('distribution excludes sources, development metadata and private configuration', () => {
  for (const file of fs.readdirSync(destination, { recursive: true })) {
    assert.doesNotMatch(file, /(^|\/)(src|node_modules|\.git|\.env|\.dev\.vars)(\/|$)|\.map$/);
    const fullPath = path.join(destination, file);
    if (!fs.statSync(fullPath).isFile()) continue;
    assert.doesNotMatch(fs.readFileSync(fullPath, 'utf8'), /tandry-cloud|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|\/Users\//);
  }
});

test('exported Claude and Codex MCP servers run outside the workspace and report their release version', { timeout: 10_000 }, async t => {
  for (const host of ['claude', 'codex']) {
    const plugin = path.join(destination, 'clients', host);
    const config = read(`clients/${host}/.mcp.json`).mcpServers.tandry;
    assert.equal(config.command, 'node');
    const child = spawn(process.execPath,
      config.args.map(arg => arg.replace('${CLAUDE_PLUGIN_ROOT}', plugin)), {
        cwd: config.cwd ? path.resolve(plugin, config.cwd) : temporary,
        env: { ...process.env, TANDRY_HOME: path.join(temporary, 'state'), TANDRY_HUB: 'http://127.0.0.1:1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    t.after(() => child.kill());
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const responses = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    async function request(id, method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const { value, done } = await responses.next();
      assert.equal(done, false, stderr);
      const response = JSON.parse(value);
      assert.equal(response.id, id);
      assert.equal(response.error, undefined);
      return response.result;
    }
    const initialized = await request(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'package-test', version: '1' } });
    assert.equal(initialized.serverInfo.version, read(`clients/${host}/package.json`).version);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { tools } = await request(2, 'tools/list', {});
    assert.equal(tools.length, host === 'codex' ? 10 : 9);
    const status = await request(3, 'tools/call', { name: 'status', arguments: {} });
    assert.equal(status.isError, false);
    assert.match(status.content[0].text, /not signed in/i);
    child.stdin.end();
  }
});

test('the exported Claude hook runs as a standalone small bundle', () => {
  const output = execFileSync(process.execPath, [path.join(destination, 'clients/claude/dist/hook.cjs'), 'SessionStart'], {
    cwd: temporary,
    env: { ...process.env, TANDRY_HOME: path.join(temporary, 'hook-state') },
    input: JSON.stringify({ session_id: 'package-test-session', cwd: temporary }),
    encoding: 'utf8',
    });
  assert.deepEqual(JSON.parse(output), {});
});
