import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// .gitignore is the source of truth. Existing tracked artifacts must be removed;
// allow already deleted legacy files while the migration is being prepared.
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--ignored', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
const artifacts = tracked.split('\0').filter(file => file && fs.existsSync(path.join(root, file)));
assert.deepEqual(artifacts, [], 'Ignored build artifacts must not be tracked in the source repository');
console.log('Source repository contains no tracked build artifacts.');

// Packages appear as the redesign reaches them; check the ones that exist.
const sourceDirs = ['packages/hub/src', 'packages/protocol/src', 'packages/bridge/src', 'website/src'].filter(dir => fs.existsSync(path.join(root, dir)));
const manifests = ['package.json', 'packages/hub/package.json', 'packages/protocol/package.json', 'packages/bridge/package.json', 'website/package.json'].filter(file => fs.existsSync(path.join(root, file)));
const sourceFiles = dirs => dirs.flatMap(dir => fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name)));
const files = sourceFiles(sourceDirs).concat(manifests.map(file => path.join(root, file)));
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  if (/tandry-cloud|@tandryio\/cloud|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|CLOUD_PLANS/.test(content)) throw new Error(`Private dependency/configuration in ${path.relative(root, file)}`);
  if (/\b(?:from|import)\s*\(?\s*['"]stripe(?:['"/])/.test(content)) throw new Error(`Payment SDK in public source: ${file}`);
}
for (const file of ['packages/hub/wrangler.jsonc', 'website/wrangler.jsonc']) {
  const config = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  if (config.account_id || config.routes?.length) throw new Error(`Official account/domain in public default: ${file}`);
  if (config.d1_databases?.some(db => db.database_id !== '00000000-0000-0000-0000-000000000001')) throw new Error(`Non-placeholder database in ${file}`);
}
console.log('Public source boundary and local deployment defaults verified.');

// Dependency direction (docs/redesign/02-architecture.md section 3): hub, bridge and
// website know each other only through protocol; a client knows only the bridge;
// clients never import each other.
const workspaceImports = file => [...fs.readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](@tandryio\/[a-z-]+|(?:\.\.\/)+(?:packages|clients)\/[^'"]+)/g)].map(match => match[1]);
const allowed = { 'packages/protocol/src': [], 'packages/hub/src': ['@tandryio/protocol'], 'packages/bridge/src': ['@tandryio/protocol'], 'website/src': ['@tandryio/protocol'] };
for (const [dir, permitted] of Object.entries(allowed)) {
  if (!fs.existsSync(path.join(root, dir))) continue;
  for (const file of sourceFiles([dir]).filter(name => /\.(ts|tsx|mts|mjs)$/.test(name)))
    for (const imported of workspaceImports(file))
      if (!permitted.includes(imported)) throw new Error(`${path.relative(root, file)} may not import ${imported}`);
}
if (fs.existsSync(path.join(root, 'clients')))
  for (const client of fs.readdirSync(path.join(root, 'clients'), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const src = path.join('clients', client.name, 'src');
    if (!fs.existsSync(path.join(root, src))) continue;
    for (const file of sourceFiles([src]).filter(name => /\.(ts|tsx|mts|mjs)$/.test(name)))
      for (const imported of workspaceImports(file))
        if (imported !== '@tandryio/bridge') throw new Error(`${path.relative(root, file)} may not import ${imported}; clients depend on the bridge only`);
  }
console.log('Dependency direction verified.');
