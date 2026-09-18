import zh from '../messages/zh.json' with { type: 'json' };
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { m } from '../src/paraglide/messages.js';
import { getLocale } from '../src/paraglide/runtime.js';
import { paraglideMiddleware } from '../src/paraglide/server.js';

test('English and Chinese catalogs have matching keys and parameters', async () => {
  const en = JSON.parse(await readFile(new URL('../messages/en.json', import.meta.url)));
  const zh = JSON.parse(await readFile(new URL('../messages/zh.json', import.meta.url)));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim() && zh[key].trim(), key);
    const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(params(en[key]), params(zh[key]), key);
    assert.ok(!/[\u3400-\u9fff]/.test(en[key]), `English source contains Chinese: ${key}`);
    assert.match(key, /^(meta|nav|common|error|landing|install|faq|login|connect|device|rooms|account|handle|privacy)_[a-z0-9_]+$/, `key is not namespaced: ${key}`);
  }
  assert.equal(m.login_email_code_sent({ email: 'test@example.test' }, { locale: 'en' }), 'Code sent to test@example.test. It expires in 10 minutes.');
  assert.equal(m.login_email_code_sent({ email: 'test@example.test' }, { locale: 'zh' }), zh.login_email_code_sent.replace('{email}', 'test@example.test'));
});

test('SSR defaults to English and isolates concurrent cookie locales', async () => {
  const cases = [undefined, 'invalid', ...Array.from({ length: 12 }, (_, i) => i % 2 ? 'zh' : 'en')];
  await Promise.all(cases.map(async (locale, index) => {
    const request = new Request('http://localhost/account', { headers: {
      'Accept-Language': 'zh-CN', ...(locale ? { Cookie: `tandry-locale=${locale}` } : {}),
    } });
    const response = await paraglideMiddleware(request, async () => {
      await new Promise(resolve => setTimeout(resolve, index % 3));
      return Response.json({ locale: getLocale(), profile: m.nav_profile() });
    });
    assert.deepEqual(await response.json(), locale === 'zh' ? { locale: 'zh', profile: zh.nav_profile } : { locale: 'en', profile: 'Profile' });
  }));
});
