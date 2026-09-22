import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/agent.mjs', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));

test('local agent launcher loads the implemented hosts with isolated Tandry data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tandry-launcher-test-'));
  const server = createServer((_req, res) => res.end('{"ok":true}'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
const env = process.env;
const dsh = name === 'dsh' ? JSON.parse(fs.readFileSync(args[args.indexOf('--patch') + 1], 'utf8')) : undefined;
fs.appendFileSync(env.TEST_LOG, JSON.stringify({name, args, dsh, hub: env.TANDRY_HUB, home: env.TANDRY_HOME, opencode: env.OPENCODE_CONFIG_CONTENT}) + '\\n');
if (name === 'codex' && args.includes('--json')) {
  console.log(JSON.stringify(args.includes('marketplace') ? {marketplaces: [{name:'tandry-marketplace', root:env.TEST_ROOT}]} : {installed:[{pluginId:'tandry@tandry-marketplace'}]}));
}
if (!args.includes('plugin')) process.exit(Number(env.TEST_EXIT || 0));
`;
  for (const name of ['pnpm', 'claude', 'codex', 'grok', 'pi', 'opencode', 'dsh']) {
    await writeFile(join(dir, name), fake, { mode: 0o700 });
  }
  async function launch(host, extra = [], overrides = {}) {
    const log = join(dir, 'calls.jsonl');
    await writeFile(log, '');
    const env = {
      ...process.env, PATH: dir, TEST_LOG: log, TEST_ROOT: join(root, '.local/marketplace'),
      TANDRY_HUB: `http://127.0.0.1:${server.address().port}`,
      TANDRY_HOME: join(dir, 'data'),
      ...overrides,
    };
    const child = spawn(process.execPath, [script, host, ...extra], { env, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.resume();
    const code = await new Promise(resolve => child.once('exit', resolve));
    const calls = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    return { code, calls, stderr };
  }
  for (const host of ['claude', 'codex', 'grok', 'pi', 'opencode', 'dsh']) {
    await t.test(host, async () => {
      const overrides = host === 'opencode' ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'fixture/test', plugin: ['file:///fixture/other.js'] }) } : {};
      const { code, calls, stderr } = await launch(host, ['--', '--help', 'argument with spaces'], overrides);
      assert.equal(code, 0, stderr);
      assert.deepEqual(calls[0].args, ['build']);
      const last = calls.at(-1);
      assert.deepEqual(last.args.slice(-2), ['--help', 'argument with spaces']);
      assert.equal(last.home, join(dir, 'data'));
      assert.equal(last.hub, `http://127.0.0.1:${server.address().port}`);
      if (host === 'claude') assert.equal(last.args[0], '--plugin-dir');
      if (host === 'pi') assert.deepEqual(last.args.slice(0, 2), ['--extension', join(root, 'clients/pi/dist/index.cjs')]);
      if (host === 'opencode') {
        const config = JSON.parse(last.opencode);
        assert.match(config.plugin.at(-1), /\/clients\/opencode\/dist\/index\.js$/);
        assert.equal(config.plugin[0], 'file:///fixture/other.js');
        assert.equal(config.model, 'fixture/test');
      }
      if (host === 'dsh') {
        assert.match(last.dsh[0].insert[0].name, /\/clients\/dsh\/dist\/index\.js$/);
        assert.equal(last.dsh[0].insert[0].config.wakeable, true);
      }
      if (host === 'codex') {
        assert.deepEqual(calls.slice(-3, -1).map(call => call.args.slice(0, 2)), [['plugin', 'remove'], ['plugin', 'add']]);
      }
      if (host === 'grok') {
        assert.deepEqual(calls.slice(-4, -1).map(call => call.args.slice(0, 2)), [['plugin', 'uninstall'], ['plugin', 'install'], ['plugin', 'enable']]);
        assert.deepEqual(calls.at(-3).args.slice(2), [join(root, 'clients/grok'), '--trust']);
      }
    });
  }
  const headless = await launch('dsh', ['--profile', 'headless', 'status']);
  assert.equal(headless.code, 0, headless.stderr);
  assert.equal(headless.calls.at(-1).dsh[0].insert[0].config.wakeable, false);
  const failed = await launch('claude', [], { TEST_EXIT: '7' });
  assert.equal(failed.code, 7);
  assert.equal(failed.calls.length, 1, 'failed build must not launch host');
  const offline = await launch('claude', [], { TANDRY_HUB: 'http://127.0.0.1:1' });
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /pnpm dev/);
  assert.equal(offline.calls.length, 0);
});
