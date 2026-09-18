import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = fileURLToPath(new URL('../', import.meta.url));
const hosts = ['claude', 'codex', 'pi', 'opencode', 'dsh'];
export const marketplace = path.join(root, '.local/marketplace');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();

async function buildClients(selected = hosts) {
  const version = process.env.RELEASE_VERSION;
  assert.ok(version === undefined || semver.valid(version) === version, 'RELEASE_VERSION must be a canonical semantic version.');
  for (const host of selected) {
    if (!hosts.includes(host)) throw new Error(`Unknown client: ${host}`);
    const directory = new URL(`../clients/${host}/`, import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(new URL('package.json', directory), 'utf8'));
    const outdir = fileURLToPath(new URL('dist/', directory));
    // Recreate only the generated directory; obsolete runtime bundles must not ship.
    fs.rmSync(outdir, { recursive: true, force: true });
    await build({
      absWorkingDir: fileURLToPath(directory),
      entryPoints: host === 'claude' ? { main: 'src/main.ts', hook: 'src/hook.ts' }
        : ['pi', 'opencode', 'dsh'].includes(host) ? { index: 'src/index.ts' } : { tandry: 'src/main.ts' },
      outdir, outExtension: { '.js': ['opencode', 'dsh'].includes(host) ? '.js' : '.cjs' },
      bundle: true, format: ['opencode', 'dsh'].includes(host) ? 'esm' : 'cjs', platform: 'node', target: 'node22',
      ...(['opencode', 'dsh'].includes(host) ? { banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } } : {}),
      // OpenCode runs in Bun, whose built-in ws implements its socket transport.
      // Bundling npm ws leaves node:http's upgrade handshake stuck in Bun.
      external: ['bufferutil', 'utf-8-validate', ...(host === 'opencode' ? ['ws'] : []), ...(host === 'pi' ? ['typebox'] : [])],
      define: { TANDRY_VERSION: JSON.stringify(version ?? pkg.version) },
      // Pi's bundled CLI loads CJS directly; export the factory, not { default }.
      ...(host === 'pi' ? { footer: { js: 'module.exports = module.exports.default;' } } : {}),
      logLevel: 'info',
    });
  }
}

// Package managers own file selection and metadata. Only this fixed, ignored
// build directory is replaced; syncing a separate Git checkout belongs to release.
function exportMarketplace() {
  const version = process.env.RELEASE_VERSION;
  assert.ok(version === undefined || semver.valid(version) === version, 'RELEASE_VERSION must be a canonical semantic version.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tandry-pack-'));
  try {
    const packages = JSON.parse(run('pnpm', ['--filter', './clients/*', 'list', '--depth', '-1', '--json']));
    fs.rmSync(marketplace, { recursive: true, force: true });
    fs.cpSync(path.join(root, 'deploy/marketplace'), marketplace, { recursive: true });
    for (const pkg of packages) {
      const archive = path.join(temporary, 'plugin.tgz');
      run('pnpm', ['pack', '--out', archive], pkg.path);
      const destination = path.join(marketplace, 'clients', path.basename(pkg.path));
      fs.mkdirSync(destination, { recursive: true });
      run('tar', ['-xzf', archive, '--strip-components=1', '-C', destination]);
      for (const file of fs.globSync('{package.json,.*-plugin/plugin.json}', { cwd: destination })) {
        const manifest = path.join(destination, file);
        const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        metadata.version = version ?? metadata.version;
        fs.writeFileSync(manifest, JSON.stringify(metadata, null, 2) + '\n');
      }
    }
    for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
      fs.copyFileSync(path.join(root, file === 'LICENSE' ? file : `licenses/${file}`), path.join(marketplace, file));
    }
    fs.writeFileSync(path.join(marketplace, 'release.json'), JSON.stringify({
      source: { repository: 'https://github.com/tandryio/tandry', commit: run('git', ['rev-parse', 'HEAD']), dirty: Boolean(run('git', ['status', '--porcelain'])) },
      versions: Object.fromEntries(packages.map(pkg => [path.basename(pkg.path), version ?? pkg.version])),
    }, null, 2) + '\n');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Marketplace exported to ${marketplace}`);
}

async function packagePlugins() {
  await buildClients();
  run('pnpm', ['generate:commands']);

  for (const host of hosts)
    for (const file of ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md'])
      fs.copyFileSync(new URL(file === 'LICENSE' ? `../${file}` : `../licenses/${file}`,import.meta.url),new URL(`../clients/${host}/${file}`,import.meta.url));

  exportMarketplace();
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action = 'build', ...selected] = process.argv.slice(2);
  const actions = {
    build: packagePlugins,
    client: () => buildClients(selected.length ? selected : hosts),
  };
  assert.ok(Object.hasOwn(actions, action), 'Expected build or client [host...]');
  await actions[action]();
}
