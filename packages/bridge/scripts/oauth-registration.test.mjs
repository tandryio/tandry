import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareAuth } from './fixtures/auth.mjs';

test('OAuth: GitHub and Google create accounts first, then the handle gate opens rooms', { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aroom-oauth-'));
  const reserve = createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const hub = fileURLToPath(new URL('../../hub/', import.meta.url));
  // Only provider network calls are mocked; OAuth state/cookies, callbacks,
  // D1 writes and session creation use the production auth config.
  const entry = path.join(root, 'worker.ts');
  fs.writeFileSync(entry, `
    import app, { TeamRoom } from ${JSON.stringify(path.join(hub, 'src/index.ts'))};
    import { authFor } from ${JSON.stringify(path.join(hub, 'src/auth.ts'))};
    export { TeamRoom };
    export default { async fetch(request, env, ctx) {
      const route = new URL(request.url).pathname;
      if (route === '/test/reset-rate') { await env.AUTH_DB.prepare('DELETE FROM rateLimit').run(); return Response.json({ok:true}); }
      if (route === '/test/users') return Response.json(await env.AUTH_DB.prepare('SELECT email,handle,name FROM user').all());
      if (route === '/api/auth/sign-in/social' || route.startsWith('/api/auth/callback/')) {
        const auth = authFor(env);
        const context = await auth.$context;
        for (const provider of context.socialProviders) {
          provider.validateAuthorizationCode = async ({code}) => ({accessToken: code});
          provider.getUserInfo = async ({accessToken}) => ({user: {id: accessToken, email: accessToken + '@example.test', name: 'OAuth tester', emailVerified: true}, data: {id: accessToken, sub: accessToken}});
        }
        return auth.handler(request);
      }
      return app.fetch(request, env, ctx);
    }};
  `);
  const config = path.join(root, 'wrangler.json');
  fs.writeFileSync(config, JSON.stringify({
    name: 'aroom-oauth-test', main: entry,
    vars: { GITHUB_CLIENT_ID: 'test-github', GITHUB_CLIENT_SECRET: 'test-secret', GOOGLE_CLIENT_ID: 'test-google', GOOGLE_CLIENT_SECRET: 'test-secret' },
    durable_objects: { bindings: [{ name: 'TEAM_ROOM', class_name: 'TeamRoom' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['TeamRoom'] }],
  }));
  await prepareAuth(config, root, origin);
  const worker = spawn(process.execPath, [path.join(hub, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--local', '--config', config, '--port', String(port), '--inspector-port', '0',
    '--persist-to', path.join(root, 'hub-state'), '--show-interactive-dev-session=false'], {
    cwd: hub, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  worker.stdout.on('data', data => { output += data; });
  worker.stderr.on('data', data => { output += data; });
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(origin + '/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    async function oauth(provider, code) {
      await fetch(origin + '/test/reset-rate'); // Better Auth's sign-in limit is stricter than this loop
      const start = await fetch(origin + '/api/auth/sign-in/social', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({provider, callbackURL: origin + '/rooms', errorCallbackURL: origin + '/login'}),
      });
      assert.equal(start.status, 200, await start.clone().text());
      const {url} = await start.json();
      const state = new URL(url).searchParams.get('state');
      assert.ok(state);
      const cookie = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const callback = await fetch(origin + `/api/auth/callback/${provider}?code=${code}&state=${encodeURIComponent(state)}`, {headers: {Cookie: cookie}, redirect: 'manual'});
      assert.equal(callback.headers.get('location'), origin + '/rooms', 'no sign-in/sign-up mode: every provider login lands on the app');
      const session = callback.headers.getSetCookie().map(value => value.split(';')[0]).find(value => value.includes('session_token'));
      assert.ok(session);
      return { Cookie: session, Origin: origin, 'Content-Type': 'application/json' };
    }
    async function api(route, headers, body) {
      return fetch(origin + route, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    for (const provider of ['github', 'google']) {
      const headers = await oauth(provider, provider + '-new');
      assert.deepEqual((await (await api('/api/profile', headers)).json()).handle, null);
      const gated = await api('/api/rooms', headers);
      assert.equal(gated.status, 403);
      assert.equal((await gated.json()).code, 'HANDLE_REQUIRED', 'rooms stay closed until a handle is chosen');
      assert.equal((await api('/api/profile/handle', headers, { handle: 'TEST_ALICE' })).status, 409, 'seeded handle is taken');
      assert.equal((await api('/api/profile/handle', headers, { handle: 'admin' })).status, 400, 'reserved handle');
      assert.equal((await api('/api/profile/handle', headers, { handle: `@${provider}_Tester` })).status, 200);
      assert.equal((await (await api('/api/profile', headers)).json()).handle, `${provider}_tester`);
      assert.equal((await api('/api/rooms', headers)).status, 200, 'gate opens once the handle is set');
      assert.equal((await api('/api/profile/handle', headers, { handle: 'another' })).status, 409, 'handle cannot be changed');
      const returning = await oauth(provider, provider + '-new');
      assert.equal((await (await api('/api/profile', returning)).json()).handle, `${provider}_tester`, 'returning users keep their handle');
    }
    const users = (await (await fetch(origin + '/test/users')).json()).results;
    assert.equal(users.length, 4, 'two seeded users plus one account per provider');
    assert.ok(users.every(user => user.handle));
  } finally {
    const done = once(worker, 'exit');
    process.kill(-worker.pid, 'SIGTERM');
    await done;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
