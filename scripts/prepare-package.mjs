import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = ['packages/hub', 'packages/protocol', 'packages/web', 'website'].map((p) =>
  path.join(root, p),
);
if (!allowed.includes(process.cwd()))
  throw new Error('Run from a public package directory.');
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'])
  copyFileSync(path.join(root, name === 'LICENSE' ? name : `licenses/${name}`), path.join(process.cwd(), name));

if (process.cwd() === path.join(root, 'packages/web'))
  copyFileSync(path.join(root, 'licenses/THIRD_PARTY_NOTICES.md'), path.join(process.cwd(), 'public/third-party-notices.txt'));
