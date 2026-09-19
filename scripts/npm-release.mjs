import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = fileURLToPath(new URL('../', import.meta.url));
export const hosts = ['pi', 'opencode', 'dsh'];
const group = process.env.NPM_GROUP ?? 'clients';
assert.ok(['clients', 'core'].includes(group), 'NPM_GROUP must be clients or core.');
const selected = group === 'core' ? ['protocol', 'hub', 'web'] : hosts;
const packageName = host => group === 'core' ? `@tandryio/${host}` : `@tandryio/client-${host}`;
const output = path.join(root, group === 'core' ? '.local/npm-core' : '.local/npm');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

export function releaseOptions(version, tag = 'next') {
  assert.ok(version && semver.valid(version) === version, 'RELEASE_VERSION must be canonical semver.');
  assert.ok(['latest', 'next'].includes(tag), 'NPM_TAG must be latest or next.');
  assert.ok(tag !== 'latest' || !semver.prerelease(version), 'Prereleases cannot use latest.');
  return { version, tag };
}

export function checkPackage(pkg, host, version, files) {
  assert.ok(hosts.includes(host));
  assert.equal(pkg.name, `@tandryio/client-${host}`);
  assert.equal(pkg.version, version);
  for (const field of ['private', 'scripts', 'devDependencies', 'dependencies'])
    assert.equal(pkg[field], undefined, `Unexpected ${field} in ${pkg.name}`);
  assert.equal(pkg.repository.url, 'git+https://github.com/tandryio/tandry.git');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
  const required = ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md',
    host === 'pi' ? 'dist/index.cjs' : 'dist/index.js'];
  if (host === 'pi') {
    assert.deepEqual(pkg.pi.extensions, ['./dist/index.cjs']);
    assert.deepEqual(pkg.peerDependencies, { typebox: '*' });
    assert.ok(pkg.keywords.includes('pi-package'));
  } else assert.equal(pkg.main, './dist/index.js');
  if (host === 'dsh') {
    assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
    required.push('cordis.patch.yml', 'skills/join/SKILL.md');
  }
  for (const file of required) assert.ok(files.includes(file), `Missing ${host}/${file}`);
  for (const file of files) {
    assert.ok(required.includes(file) || (host === 'dsh' && /^skills\/[a-z-]+\/SKILL\.md$/.test(file)), `Unexpected ${host}/${file}`);
  }
}

export function checkCorePackage(pkg, name, version, files) {
  assert.equal(pkg.name, `@tandryio/${name}`);
  assert.equal(pkg.version, version);
  for (const key of ['private', 'scripts', 'devDependencies']) assert.equal(pkg[key], undefined);
  for (const [dependency, range] of Object.entries(pkg.dependencies ?? {})) {
    assert.doesNotMatch(range, /^(workspace:|file:|link:)/);
    if (dependency.startsWith('@tandryio/')) assert.equal(range, version);
  }
  const allowed = name === 'web' ? ['src/', 'content/', 'messages/', 'public/', 'scripts/'] : name === 'hub' ? ['src/', 'migrations/', 'testing/'] : ['src/'];
  const common = ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'];
  for (const file of common) assert.ok(files.includes(file), `Missing ${name}/${file}`);
  if (name === 'web') for (const file of ['src/paraglide/messages.js', 'src/paraglide/runtime.js', 'src/paraglide/server.js', 'public/third-party-notices.txt', 'content/docs/index.mdx', 'vite.mjs', 'vite.d.mts'])
    assert.ok(files.includes(file), `Missing web/${file}`);
  const entry = 'src/index.ts';
  assert.ok(files.includes(entry), `Missing ${name}/${entry}`);
  for (const file of files) {
    assert.ok(common.includes(file) || (name === 'web' && ['vite.mjs', 'vite.d.mts'].includes(file)) || (name === 'hub' && file === 'worker-configuration.d.ts') || allowed.some(prefix => file.startsWith(prefix)), `Unexpected ${name}/${file}`);
    assert.doesNotMatch(file, /(^|\/)(\.env|\.dev\.vars|node_modules|\.git)(\.|\/|$)|\.map$|(?:^|\/)\.\.(?:\/|$)/);
  }
}

function packCore(options) {
  assert.equal(process.env.CORE_RELEASE_VERSION, options.version, 'CORE_RELEASE_VERSION must match RELEASE_VERSION.');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const packages = selected.map(host => {
    const directory = path.join(root, `packages/${host}`);
    const filename = `tandryio-${host}-${options.version}.tgz`;
    const archive = path.join(output, filename);
    run('pnpm', ['pack', '--out', archive], directory);
    const files = run('tar', ['-tzf', archive]).trim().split('\n').filter(file => !file.endsWith('/')).map(file => {
      assert.ok(file.startsWith('package/'));
      return file.slice('package/'.length);
    });
    const pkg = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']));
    checkCorePackage(pkg, host, options.version, files);
    for (const file of files)
      assert.doesNotMatch(run('tar', ['-xOzf', archive, `package/${file}`]), /@tandryio\/cloud|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|\/Users\//);
    return { host, name: pkg.name, filename, integrity: 'sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64') };
  });
  const source = { repository: 'https://github.com/tandryio/tandry', commit: run('git', ['rev-parse', 'HEAD']).trim(), dirty: Boolean(run('git', ['status', '--porcelain']).trim()) };
  fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({ ...options, source, packages }, null, 2) + '\n');
  console.log(`Validated core npm archives in ${output}`);
}

function pack(options) {
  const source = path.join(root, '.local/marketplace');
  const release = JSON.parse(fs.readFileSync(path.join(source, 'release.json'), 'utf8'));
  assert.equal(release.source.commit, run('git', ['rev-parse', 'HEAD']).trim(), 'Rebuild packages from the current checkout.');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const packages = hosts.map(host => {
    assert.equal(release.versions[host], options.version, 'Run npm:pack with the requested RELEASE_VERSION.');
    const directory = path.join(source, 'clients', host);
    const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], directory));
    const archive = path.join(output, packed.filename);
    const pkg = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']));
    checkPackage(pkg, host, options.version, packed.files.map(file => file.path));
    const integrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
    assert.equal(integrity, packed.integrity);
    return { host, name: pkg.name, filename: packed.filename, integrity };
  });
  fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({ ...options, source: release.source, packages }, null, 2) + '\n');
  console.log(`Validated npm archives in ${output}`);
}

// Check the whole batch before publishing; identical partial releases are resumable.
export async function unpublishedPackages(packages, version, lookup = fetch) {
  const pending = [];
  for (const pkg of packages) {
    const response = await lookup(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${version}`, { signal: AbortSignal.timeout(30_000) });
    if (response.ok) {
      const remote = await response.json();
      assert.equal(remote.dist.integrity, pkg.integrity, `${pkg.name}@${version} already exists with different contents.`);
      console.log(`Already published: ${pkg.name}@${version}; leaving dist-tags unchanged.`);
    } else {
      assert.equal(response.status, 404, `Cannot check ${pkg.name}: HTTP ${response.status}`);
      pending.push(pkg);
    }
  }
  return pending;
}

async function publish(options, dryRun) {
  const release = JSON.parse(fs.readFileSync(path.join(output, 'release.json'), 'utf8'));
  assert.equal(release.version, options.version);
  assert.equal(release.tag, options.tag);
  assert.deepEqual(release.packages.map(pkg => pkg.host), selected);
  if (!dryRun) assert.equal(release.source.dirty, false, 'Publish only from a clean checkout.');
  for (const pkg of release.packages) {
    assert.equal(pkg.name, packageName(pkg.host));
    assert.equal(path.basename(pkg.filename), pkg.filename);
    const archive = path.join(output, pkg.filename);
    assert.equal('sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64'), pkg.integrity, 'Archive changed after validation.');
  }
  const pending = dryRun ? release.packages : await unpublishedPackages(release.packages, options.version);
  for (const pkg of pending) {
    const archive = path.join(output, pkg.filename);
    execFileSync('npm', ['publish', archive, '--access', 'public', '--tag', options.tag,
      '--registry', 'https://registry.npmjs.org/', '--ignore-scripts',
      ...(dryRun ? ['--dry-run'] : ['--provenance'])], { cwd: root, stdio: 'inherit' });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  const options = releaseOptions(process.env.RELEASE_VERSION, process.env.NPM_TAG);
  assert.ok(['validate', 'pack', 'dry-run', 'publish'].includes(action), 'Expected validate, pack, dry-run or publish.');
  if (action === 'pack') (group === 'core' ? packCore : pack)(options);
  if (action === 'dry-run' || action === 'publish') await publish(options, action === 'dry-run');
}
