import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = fileURLToPath(new URL('../', import.meta.url));
export const hosts = ['pi', 'opencode', 'dsh'];
const selected = hosts;
const packageName = host => `@tandryio/${host}`;
const output = path.join(root, '.local/npm');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

export function releaseOptions(version) {
  assert.ok(version && semver.valid(version) === version, 'RELEASE_VERSION must be canonical semver.');
  return { version };
}

export function checkPackage(pkg, host, version, files) {
  assert.ok(hosts.includes(host));
  assert.equal(pkg.name, `@tandryio/${host}`);
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
    // Every release is what an unqualified install gets. npm refuses a prerelease without an explicit tag.
    execFileSync('npm', ['publish', archive, '--access', 'public', '--tag', 'latest',
      '--registry', 'https://registry.npmjs.org/', '--ignore-scripts',
      ...(dryRun ? ['--dry-run'] : ['--provenance'])], { cwd: root, stdio: 'inherit' });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  const options = releaseOptions(process.env.RELEASE_VERSION);
  assert.ok(['validate', 'pack', 'dry-run', 'publish'].includes(action), 'Expected validate, pack, dry-run or publish.');
  if (action === 'pack') pack(options);
  if (action === 'dry-run' || action === 'publish') await publish(options, action === 'dry-run');
}
