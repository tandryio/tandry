import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
import { checkPackage, hosts, releaseOptions, unpublishedPackages } from '../scripts/npm-release.mjs';

const root = fileURLToPath(new URL('../.local/marketplace/clients/', import.meta.url));

test('release inputs reject ambiguous versions and prereleases on latest', () => {
  assert.deepEqual(releaseOptions('0.5.0'), { version: '0.5.0', tag: 'next' });
  assert.deepEqual(releaseOptions('0.5.1-rc.1', 'next'), { version: '0.5.1-rc.1', tag: 'next' });
  for (const version of [undefined, 'v0.5.0', 'latest', '0.5', '0.5.0; echo bad'])
    assert.throws(() => releaseOptions(version));
  assert.throws(() => releaseOptions('0.5.1-rc.1', 'latest'));
  assert.throws(() => releaseOptions('0.5.0', '--access'));
});

test('actual release packages preserve host entry points and reject unsafe contents', () => {
  for (const host of hosts) {
    const directory = path.join(root, host);
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const files = fs.readdirSync(directory, { recursive: true }).filter(file => fs.statSync(path.join(directory, file)).isFile());
    checkPackage(pkg, host, pkg.version, files);
    assert.throws(() => checkPackage(pkg, host, '999.0.0', files));
    assert.throws(() => checkPackage(pkg, host, pkg.version, files.filter(file => file !== 'LICENSE')));
    assert.throws(() => checkPackage(pkg, host, pkg.version, [...files, '.dev.vars']));
    assert.throws(() => checkPackage({ ...pkg, scripts: { prepublishOnly: 'unexpected' } }, host, pkg.version, files));
    assert.throws(() => checkPackage({ ...pkg, dependencies: { '@tandryio/bridge': 'workspace:*' } }, host, pkg.version, files));
  }
});

test('registry preflight resumes identical versions and fails closed on conflicts or outages', async () => {
  const packages = hosts.map(host => ({ name: `@tandryio/${host}`, integrity: `sha512-${host}` }));
  let calls = 0;
  const pending = await unpublishedPackages(packages, '0.5.0', async () => {
    const pkg = packages[calls++];
    return calls === 1 ? Response.json({ dist: { integrity: pkg.integrity } }) : new Response(null, { status: 404 });
  });
  assert.equal(calls, 3);
  assert.deepEqual(pending, packages.slice(1));
  await assert.rejects(unpublishedPackages(packages, '0.5.0', async () => Response.json({ dist: { integrity: 'different' } })), /different contents/);
  for (const status of [401, 403, 429, 500])
    await assert.rejects(unpublishedPackages(packages, '0.5.0', async () => new Response(null, { status })), /Cannot check/);
  await assert.rejects(unpublishedPackages(packages, '0.5.0', async () => { throw new Error('offline'); }), /offline/);
});

test('core release packing rewrites public dependencies without changing source versions', () => {
  const hook = createRequire(import.meta.url)('../.pnpmfile.cjs');
  const previous = process.env.CORE_RELEASE_VERSION;
  process.env.CORE_RELEASE_VERSION = '0.1.1-alpha.1';
  try {
    const packed = hook.hooks.beforePacking({ name: '@tandryio/hub', version: '0.1.0', dependencies: { '@tandryio/protocol': 'workspace:*', hono: '^4.6.0' }, scripts: { build: 'tsc' }, devDependencies: {} });
    assert.equal(packed.version, '0.1.1-alpha.1');
    assert.equal(packed.dependencies['@tandryio/protocol'], packed.version);
    assert.equal(packed.dependencies.hono, '^4.6.0');
    assert.equal(packed.scripts, undefined);
  } finally {
    if (previous === undefined) delete process.env.CORE_RELEASE_VERSION;
    else process.env.CORE_RELEASE_VERSION = previous;
  }
});
