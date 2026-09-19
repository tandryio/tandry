import { writeFile } from 'node:fs/promises';
import { compile } from '@inlang/paraglide-js';
await compile({
  project: './project.inlang',
  outdir: './src/paraglide',
  outputStructure: 'message-modules',
  emitTsDeclarations: true,
  cookieName: 'tandry-locale',
  strategy: ['cookie', 'baseLocale'],
});

// Publish generated locale modules even though they are excluded from Git.
await writeFile('./src/paraglide/.npmignore', '');
