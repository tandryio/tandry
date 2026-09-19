import { fileURLToPath } from 'node:url';
import { searchForWorkspaceRoot } from 'vite';

/** App-specific routing stays in the consumer. Assets and shared source come from this package. */
export function webConfig() {
  const packageRoot = fileURLToPath(new URL('./', import.meta.url));
  return {
    // Linked development packages and their assets live outside the Cloud workspace.
    server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), searchForWorkspaceRoot(packageRoot)] } },
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    // Fumadocs config prebundles its nested CommonJS dependencies from the app.
    // Shared pages must resolve that same dependency tree during browser hydration.
    resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', '@tanstack/react-start', 'motion', 'fumadocs-core', 'fumadocs-mdx', 'fumadocs-ui'] },
    ssr: { noExternal: ['@tandryio/web'] },
    optimizeDeps: { exclude: ['@tandryio/web'], include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    environments: { ssr: { optimizeDeps: { include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'] } } },
  };
}
