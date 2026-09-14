import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareAuth, alice } from './fixtures/auth.mjs';

test('email OTP: Resend delivery, first sign-in, handle claim, existing identity, one-time codes and limits', { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aroom-email-'));
  const reserve = createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const hub = fileURLToPath(new URL('../../hub/', import.meta.url));
  // Resend is intercepted only in this temporary test entrypoint, never in production code.
  const entry = path.join(root, 'worker.ts');
  fs.writeFileSync(entry, `
    import app, { TeamRoom } from ${JSON.stringify(path.join(hub, 'src/index.ts'))};
    export { TeamRoom };
    let mail;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (url !== 'https://api.resend.com/emails') return original(url, init);
      mail = JSON.parse(init.body);
      if (init.headers.Authorization !== 'Bearer test-resend-key') throw new Error('Missing key');
      return new Response('{}', {status: mail.to[0] === 'fail@example.test' ? 503 : 200});
    };
    export default { async fetch(request, env, ctx) {
      const route = new URL(request.url).pathname;
      if (route === '/test/mail') return Response.json(mail);
      if (route === '/test/reset-rate') { await env.AUTH_DB.prepare('DELETE FROM rateLimit').run(); return Response.json({ok:true}); }
      if (route === '/test/users') return Response.json(await env.AUTH_DB.prepare('SELECT email,handle FROM user').all());
      if (route === '/test/verification') return Response.json(await env.AUTH_DB.prepare('SELECT value FROM verification').all());
      return app.fetch(request, env, ctx);
    }};
  `);
  const config = path.join(root, 'wrangler.json');
  fs.writeFileSync(config, JSON.stringify({
    name: 'aroom-email-test', main: entry,
    vars: { RESEND_API_KEY: 'test-resend-key', RESEND_FROM: 'Agent Room <login@example.test>' },
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
  const sendPath = '/api/auth/email-otp/send-verification-otp';
  const signPath = '/api/auth/sign-in/email-otp';
  async function post(route, body, ip = '192.0.2.1', requestOrigin = origin) {
    return fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
  }
  async function code() {
    const mail = await (await fetch(origin + '/test/mail')).json();
    assert.equal(mail.from, 'Agent Room <login@example.test>');
    return mail.text.match(/\d{6}/)[0];
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(origin + '/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    assert.ok((await (await fetch(origin + '/api/config')).json()).providers.includes('email'));
    const email = 'new@example.test';
    assert.equal((await post(sendPath, { email, type: 'sign-in' }, undefined, 'https://evil.test')).status, 403);
    assert.equal((await post(sendPath, { email, type: 'forget-password' })).status, 400);
    assert.equal((await post(sendPath, { email, type: 'sign-in' })).status, 200);
    const otp = await code();
    assert.equal((await (await fetch(origin + '/test/mail')).json()).subject, 'Your Agent Room sign-in code');
    const stored = await (await fetch(origin + '/test/verification')).json();
    assert.ok(stored.results.length);
    assert.ok(stored.results.every(row => !row.value.startsWith(otp + ':')), 'OTP must not be stored as plaintext');
    assert.equal((await post(sendPath, { email: email.toUpperCase(), type: 'sign-in' })).status, 429);
    assert.equal((await post(signPath, { email, otp: 'invalid' })).status, 400);
    const login = await post(signPath, { email, otp });
    assert.equal(login.status, 200);
    assert.ok(login.headers.get('set-cookie'));
    const account = await login.json();
    assert.equal(account.user.emailVerified, true);
    assert.equal((await post(signPath, { email, otp })).status, 400);
    const me = await fetch(origin + '/api/me', { headers: { Authorization: `Bearer ${account.token}` } });
    assert.equal((await me.json()).userId, account.user.id);
    const authHeaders = { Authorization: `Bearer ${account.token}`, Origin: origin, 'Content-Type': 'application/json' };
    const updated = await fetch(origin + '/api/auth/update-user', { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'Updated profile' }) });
    assert.equal(updated.status, 200);
    const profile = await (await fetch(origin + '/api/profile', { headers: authHeaders })).json();
    assert.equal(profile.name, 'Updated profile');
    assert.equal(profile.handle, null, 'identity is established before any handle exists');
    assert.equal(profile.userId, account.user.id);
    const gated = await fetch(origin + '/api/rooms', { headers: authHeaders });
    assert.equal(gated.status, 403);
    assert.equal((await gated.json()).code, 'HANDLE_REQUIRED');
    const claim = body => fetch(origin + '/api/profile/handle', { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
    assert.equal((await claim({ handle: 'admin' })).status, 400, 'reserved handle');
    assert.equal((await claim({ handle: 'TEST_ALICE' })).status, 409, 'taken handle');
    assert.equal((await claim({})).status, 400, 'missing handle');
    assert.equal((await claim({ handle: 'Email_Tester' })).status, 200);
    assert.equal((await claim({ handle: 'second' })).status, 409, 'handle is claimed once');
    assert.equal((await (await fetch(origin + '/api/profile', { headers: authHeaders })).json()).handle, 'email_tester');
    assert.equal((await fetch(origin + '/api/rooms', { headers: authHeaders })).status, 200, 'gate opens after the claim');
    await fetch(origin + '/test/reset-rate');
    assert.equal((await post(sendPath, { email: 'nameless@example.test', type: 'sign-in' }, '192.0.2.10')).status, 200);
    const nameless = await (await post(signPath, { email: 'nameless@example.test', otp: await code() }, '192.0.2.10')).json();
    const namelessHeaders = { Authorization: `Bearer ${nameless.token}`, Origin: origin, 'Content-Type': 'application/json' };
    assert.equal((await fetch(origin + '/api/profile/handle', { method: 'POST', headers: namelessHeaders, body: JSON.stringify({ handle: 'nameless_one' }) })).status, 200);
    assert.equal((await (await fetch(origin + '/api/profile', { headers: namelessHeaders })).json()).name, 'nameless_one', 'an empty display name defaults to the handle');
    const changeHandle = await fetch(origin + '/api/auth/update-user', { method: 'POST', headers: authHeaders, body: JSON.stringify({ handle: 'new_name' }) });
    assert.equal(changeHandle.status, 400, 'handle cannot be changed through generic profile update');
    const existingEmail = 'test-alice@example.test';
    assert.equal((await post(sendPath, { email: existingEmail, type: 'sign-in' }, '192.0.2.2')).status, 200);
    const existing = await post(signPath, { email: existingEmail, otp: await code() }, '192.0.2.2');
    assert.equal(existing.status, 200);
    assert.equal((await existing.json()).user.id, alice.id);
    assert.equal((await post(sendPath, { email: 'fail@example.test', type: 'sign-in' }, '192.0.2.3')).status, 503);
    assert.equal((await post('/api/auth/email-otp/reset-password', {})).status, 404);
    const chineseMail = await fetch(origin + sendPath, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: origin, Cookie: 'agent-room-locale=zh', 'CF-Connecting-IP': '192.0.2.4',
    }, body: JSON.stringify({ email: 'chinese@example.test', type: 'sign-in' }) });
    assert.equal(chineseMail.status, 200);
    assert.equal((await (await fetch(origin + '/test/mail')).json()).subject, 'Agent Room 登录验证码');
  } finally {
    const done = once(worker, 'exit');
    process.kill(-worker.pid, 'SIGTERM');
    await done;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
