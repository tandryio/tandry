import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configure } from '../scripts/mcp-dev.mjs';

test('MCP setup shares ordinary auth without overwriting it and switches tunnel modes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tandry-mcp-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'packages/hub'), { recursive: true });
  const ordinary = join(root, 'packages/hub/.dev.vars');
  await writeFile(ordinary, 'BETTER_AUTH_URL=http://127.0.0.1:4173\n');
  const credentials = join(root, 'credentials.json');
  await writeFile(credentials, '{}');
  const uuid = '00000000-0000-0000-0000-000000000001';
  assert.equal(await configure(root, 'https://mcp.example.com', uuid, credentials), 'https://mcp.example.com/mcp');
  const local = join(root, '.local/mcp');
  const tunnel = JSON.parse(await readFile(join(local, 'tunnel.json'), 'utf8'));
  assert.equal(tunnel['credentials-file'], credentials);
  assert.equal(tunnel.ingress[0].originRequest.httpHostHeader, '127.0.0.1:8788');
  const named = JSON.parse(await readFile(join(local, 'mprocs.yaml'), 'utf8'));
  assert.ok(named.procs.Tunnel.cmd.includes(join(local, 'tunnel.json')));
  const inspectorPorts = ['Hub', 'Website'].map(name => {
    const args = named.procs[name].cmd;
    const index = args.indexOf('--inspector-port');
    return index < 0 ? '9229' : args[index + 1];
  });
  assert.equal(new Set(inspectorPorts).size, 2, 'Concurrent Workers must not share an inspector port');
  await assert.rejects(readFile(join(local, '.env')), { code: 'ENOENT' });
  await configure(root, 'https://random.trycloudflare.com');
  assert.equal(await readFile(ordinary, 'utf8'), 'BETTER_AUTH_URL=http://127.0.0.1:4173\n');
  assert.equal(await readFile(join(local, 'origin.env'), 'utf8'), 'BETTER_AUTH_URL=https://random.trycloudflare.com\nDEV_EMAIL_OTP_ORIGIN=https://random.trycloudflare.com\n');
  const quick = JSON.parse(await readFile(join(local, 'mprocs.yaml'), 'utf8'));
  assert.equal(quick.procs.Tunnel, undefined);
  assert.deepEqual(quick.procs.Hub.cmd.slice(-4), ['--env-file', ordinary, '--env-file', join(local, 'origin.env')]);
});

test('MCP setup rejects invalid origin and tunnel arguments before creating files', async () => {
  for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/mcp', 'https://example.com?x=1']) {
    await assert.rejects(configure('/unused', origin), /HTTPS origin/);
  }
  await assert.rejects(configure('/unused', 'https://example.com', 'not-a-uuid'), /UUID/);
  await assert.rejects(configure('/unused', 'https://example.com', undefined, '/credentials'), /requires/);
});
