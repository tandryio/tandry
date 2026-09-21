import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));

const origin = z.url({ protocol: /^https$/ }).refine(value => {
  const url = new URL(value);
  return url.origin === value && !url.port && url.hostname.includes('.') && !url.hostname.endsWith('.workers.dev');
}, 'Use an HTTPS custom-domain origin without path, port or trailing slash').transform(value => new URL(value));

export const SelfHostConfig = z.strictObject({
  workerPrefix: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
  accountId: z.string().regex(/^[a-f0-9]{32}$/),
  databaseId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
  databaseName: z.string().regex(/^[a-zA-Z0-9_-]{1,63}$/),
  /** Omit to deploy without account pictures; uploading then reports that this Hub stores none. */
  bucketName: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).optional(),
  /** Where pictures are publicly served. Omit to serve them from the website origin. */
  avatarBaseUrl: z.url({ protocol: /^https$/ }).refine(value => !value.endsWith('/'), 'Drop the trailing slash').optional(),
  websiteOrigin: origin,
  hubOrigin: origin,
  policyRevision: z.int().min(1).max(100000),
  roomLimit: z.int().min(0).max(100000),
  conversationLimit: z.int().min(0).max(100000),
  roomIdleDays: z.int().min(1).max(3650),
}).refine(config => config.websiteOrigin.origin !== config.hubOrigin.origin, 'Website and Hub need distinct domains');

function configure(input) {
  if (!input) throw new Error('Usage: pnpm self-host:configure /path/to/config.json');
  const config = SelfHostConfig.parse(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')));
  const { workerPrefix: prefix, accountId: account, databaseId: database, databaseName, websiteOrigin: website, hubOrigin } = config;
  const hub = JSON.parse(fs.readFileSync(path.join(root, 'packages/hub/wrangler.jsonc'), 'utf8'));
  const web = JSON.parse(fs.readFileSync(path.join(root, 'website/wrangler.jsonc'), 'utf8'));
  const destination = path.join(root, '.self-host');
  for (const [cfg, name, domain] of [[hub, `${prefix}-hub`, hubOrigin.hostname], [web, `${prefix}-website`, website.hostname]]) {
    cfg.name = name; cfg.account_id = account; cfg.workers_dev = false;
    cfg.routes = [{ pattern: domain, custom_domain: true }];
    cfg.$schema = '../packages/hub/node_modules/wrangler/config-schema.json';
  }
  hub.main = '../packages/hub/src/index.ts';
  hub.d1_databases = [{ binding: 'AUTH_DB', database_name: databaseName, database_id: database, migrations_dir: '../packages/hub/migrations' }];
  if (config.bucketName) hub.r2_buckets = [{ binding: 'AVATARS', bucket_name: config.bucketName }];
  else delete hub.r2_buckets;
  hub.vars = { DEPLOYMENT_MODE: 'self-hosted', BETTER_AUTH_URL: website.origin,
    ...(config.avatarBaseUrl ? { AVATAR_BASE_URL: config.avatarBaseUrl } : {}),
    RESOURCE_POLICY_REVISION: String(config.policyRevision), ROOM_LIMIT: String(config.roomLimit),
    CONVERSATION_LIMIT: String(config.conversationLimit), ROOM_IDLE_DAYS: String(config.roomIdleDays) };
  web.main = '../website/src/server.ts';
  web.services = [{ binding: 'ROOM_HUB', service: hub.name }];
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, cfg] of [['hub', hub], ['website', web]])
    fs.writeFileSync(path.join(destination, `${name}.json`), JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Generated ${destination}/hub.json and website.json. No resources created or deployed.`);
}

function execute(action) {
  if (!['build', 'dry-run', 'deploy-hub', 'deploy-website'].includes(action)) throw new Error('Expected build, dry-run, deploy-hub or deploy-website');
  const hubConfig = path.join(root, '.self-host/hub.json');
  const websiteConfig = path.join(root, '.self-host/website.json');
  for (const file of [hubConfig, websiteConfig]) if (!fs.existsSync(file)) throw new Error('Run pnpm self-host:configure first.');
  const run = (directory, args, env = {}) => execFileSync('pnpm', args, { cwd: path.join(root, directory), stdio: 'inherit', env: { ...process.env, ...env } });
  if (action !== 'deploy-hub') run('website', ['run', 'build'], { CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: websiteConfig });
  if (action === 'deploy-hub' || action === 'dry-run') run('packages/hub', ['exec', 'wrangler', 'deploy', '--config', hubConfig, ...(action === 'dry-run' ? ['--dry-run'] : [])]);
  if (action === 'deploy-website' || action === 'dry-run') run('website', ['exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', ...(action === 'dry-run' ? ['--dry-run'] : [])]);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, input] = process.argv.slice(2);
  if (action === 'configure') configure(input);
  else execute(action);
}
