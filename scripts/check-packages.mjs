import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tandry-npm-check-'));
const definitions = {
  protocol: ['packages/protocol', ['src/']],
  web: ['packages/web', ['src/', 'content/', 'messages/', 'public/', 'scripts/', 'vite.mjs', 'vite.d.mts']],
  hub: [
    'packages/hub',
    ['src/', 'migrations/', 'testing/', 'worker-configuration.d.ts'],
  ],
};
try {
  execFileSync('pnpm', ['notices:check'], { cwd: root, stdio: 'inherit' });
  for (const [name, [directory, allowed]] of Object.entries(definitions)) {
    execFileSync('pnpm', ['pack', '--pack-destination', temporary], {
      cwd: path.join(root, directory),
      stdio: 'pipe',
    });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, directory, 'package.json'), 'utf8'),
    );
    const tarball = path.join(
      temporary,
      `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`,
    );
    const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      .trim()
      .split('\n');
    const common = [
      'package.json',
      'LICENSE',
      'NOTICE',
      'THIRD_PARTY_NOTICES.md',
      'README.md',
    ];
    for (const entry of entries) {
      if (entry.endsWith('/')) continue;
      const relative = entry.replace(/^package\//, '');
      if (
        !entry.startsWith('package/') ||
        relative.split('/').includes('..') ||
        (!common.includes(relative) &&
          !allowed.some((prefix) => relative.startsWith(prefix)))
      )
        throw new Error(`Unexpected packaged path: ${entry}`);
      if (
        /(^|\/)(\.env|\.dev\.vars|wrangler\.json|\.git)(\.|\/|$)|\.map$/.test(
          relative,
        )
      )
        throw new Error(`Local/deployment metadata: ${entry}`);
      const text = execFileSync('tar', ['-xOzf', tarball, entry], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
      if (
        /@tandryio\/cloud|CLOUD_PLANS|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|cloudAccount|\/Users\//.test(
          text,
        )
      )
        throw new Error(`Private data in ${entry}`);
    }
    for (const n of common)
      if (!entries.includes('package/' + n)) throw new Error(`Missing ${n}`);
    const manifest = JSON.parse(
      execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], {
        encoding: 'utf8',
      }),
    );
    if (manifest.scripts || manifest.devDependencies)
      throw new Error('Development metadata in packaged source');
    for (const version of Object.values(manifest.dependencies ?? {}))
      if (/^(workspace:|file:|link:)/.test(version))
        throw new Error('Unresolved local package dependency');
    console.log(
      `Validated packaged source layout: ${manifest.name}@${manifest.version}`,
    );
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
