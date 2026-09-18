import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function configure(directory, origin, tunnelId, credentials) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Pass a public HTTPS origin without a path, credentials, query or fragment.');
  }
  if (tunnelId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(tunnelId)) {
    throw new Error('Pass the tunnel UUID printed by cloudflared tunnel create.');
  }
  if (credentials && !tunnelId) throw new Error('A credentials file requires a tunnel UUID.');
  if (tunnelId) {
    credentials = credentials ? resolve(credentials) : join(homedir(), '.cloudflared', `${tunnelId}.json`);
    await readFile(credentials); // Fail before writing config if credentials are missing.
  }
  const local = join(directory, '.local/mcp');
  await mkdir(local, { recursive: true });
  const authPath = join(directory, 'packages/hub/.dev.vars');
  await mkdir(join(directory, 'packages/hub'), { recursive: true });
  try {
    await writeFile(authPath, `BETTER_AUTH_URL=http://127.0.0.1:4173\nBETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}\nDEV_EMAIL_OTP=console\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await writeFile(join(local, 'origin.env'), `BETTER_AUTH_URL=${url.origin}\nDEV_EMAIL_OTP_ORIGIN=${url.origin}\n`);
  const procs = {
    Hub: {
      cwd: join(directory, 'packages/hub'),
      cmd: ['pnpm', 'exec', 'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', '8799', '--inspector-port', '9230',
        '--env-file', authPath, '--env-file', join(local, 'origin.env')],
    },
    Website: {
      cwd: join(directory, 'website'),
      cmd: ['pnpm', 'exec', 'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', '8788', '--inspector-port', '9231'],
    },
  };
  if (tunnelId) {
    const tunnelPath = join(local, 'tunnel.json');
    // JSON is valid YAML; serialize values without shell or YAML interpolation.
    await writeFile(tunnelPath, JSON.stringify({
      tunnel: tunnelId,
      'credentials-file': credentials,
      ingress: [
        { hostname: url.hostname, service: 'http://127.0.0.1:8788', originRequest: { httpHostHeader: '127.0.0.1:8788' } },
        { service: 'http_status:404' },
      ],
    }, null, 2) + '\n');
    procs.Tunnel = { cwd: directory, cmd: ['cloudflared', 'tunnel', '--config', tunnelPath, '--no-autoupdate', 'run'] };
  }
  await writeFile(join(local, 'mprocs.yaml'), JSON.stringify({
    procs,
    keymap_procs: { '<C-q>': { c: 'quit' } },
    keymap_term: { '<C-q>': { c: 'quit' } },
  }, null, 2) + '\n');
  return `${url.origin}/mcp`;
}

async function main() {
  const [action, origin, tunnelId, credentials, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Too many arguments. Run pnpm mcp:setup --help.');
  if (action === 'setup' && origin && origin !== '--help') {
    const endpoint = await configure(root, origin, tunnelId, credentials);
    console.log(`Configured ${endpoint}\nAuthentication is shared with packages/hub/.dev.vars. Run pnpm dev:mcp.\nOrdinary packages/hub/.dev.vars is unchanged. No tunnel or DNS records were created.`);
  } else if (action === 'start') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('pnpm dev:mcp requires an interactive terminal.');
    const config = join(root, '.local/mcp/mprocs.yaml');
    const saved = JSON.parse(await readFile(config).catch(() => { throw new Error('Run pnpm mcp:setup <https-origin> [tunnel-uuid] [credentials-file] first.'); }));
    const originVars = parseEnv(await readFile(join(root, '.local/mcp/origin.env'), 'utf8'));
    const tunnel = saved.procs.Tunnel ? JSON.parse(await readFile(join(root, '.local/mcp/tunnel.json'), 'utf8')) : undefined;
    await configure(root, originVars.BETTER_AUTH_URL, tunnel?.tunnel, tunnel?.['credentials-file']);
    console.log('Authentication uses packages/hub/.dev.vars. With DEV_EMAIL_OTP=console, verification codes appear in the Hub panel.');
    console.log('Stop any ordinary pnpm dev session first. Building the website and applying local migrations.');
    for (const args of [
      ['--filter', '@tandryio/hub', 'db:local'],
      ['website:build'],
      ['exec', 'mprocs', '--config', config],
    ]) {
      const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) { process.exitCode = result.status || 1; break; }
    }
  } else {
    console.log('Usage: pnpm mcp:setup <https-origin> [tunnel-uuid] [credentials-file]\n       pnpm dev:mcp\nWithout a tunnel UUID, keep your separately started Quick Tunnel running.\nPersonal configuration is stored in the ignored .local/mcp directory.');
  }
}

if (process.argv[1] && pathToFileURL(isAbsolute(process.argv[1]) ? process.argv[1] : resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
