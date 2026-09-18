import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let stopping = false;

function signalChild(child, signal) {
  try {
    if (process.platform === 'win32' || child.interactive) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error.message);
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  const running = [...children];
  for (const child of running) signalChild(child, 'SIGTERM');
  // Include grandchildren such as Vite, Wrangler, and workerd.
  setTimeout(() => {
    for (const child of running) signalChild(child, 'SIGKILL');
  }, 3000).unref();
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

function run(args, interactive = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: root,
      stdio: interactive ? 'inherit' : ['ignore', 'inherit', 'inherit'],
      detached: !interactive && process.platform !== 'win32',
    });
    child.interactive = interactive;
    children.add(child);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (stopping) return resolve();
      if (code !== 0) {
        reject(new Error(`pnpm ${args.join(' ')} exited (${signal ?? code})`));
      } else resolve();
    });
  });
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is unavailable. Stop the service using it first.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

try {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('pnpm dev requires an interactive terminal. Run it directly in your terminal.');
  }
  await Promise.all([checkPort(8799), checkPort(4173)]);
  try {
    await writeFile(new URL('../packages/hub/.dev.vars', import.meta.url),
      `BETTER_AUTH_URL=http://127.0.0.1:4173\nBETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}\nDEV_EMAIL_OTP=console\n`,
      { flag: 'wx', mode: 0o600 });
    console.log('Created packages/hub/.dev.vars with a random authentication secret and console email login enabled. No Resend setup is needed.');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Using packages/hub/.dev.vars; existing configuration is unchanged.');
  }
  console.log('With DEV_EMAIL_OTP=console, sign in by email at http://127.0.0.1:4173 and copy the code from the Hub panel: [dev email OTP].');
  if (!stopping) await run(['--filter', '@tandryio/hub', 'db:local']);
  if (!stopping) {
    console.log('\nStarting local services: http://127.0.0.1:4173 (Ctrl+Q stops all services and exits)\n');
    await run(['exec', 'mprocs', '--config', 'mprocs.yaml'], true);
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
