import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeDevnetMetadataOrigin } from '../devnet-metadata.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = 'funded-workspace';
const deployment = resolve(root, '.secrets/workspace-devnet');
const stateFile = resolve(deployment, 'settings.json');

export function workspaceOrigin(env) {
  if (env.FUNDED_WORKSPACE_ORIGIN) return normalizeDevnetMetadataOrigin(env.FUNDED_WORKSPACE_ORIGIN);
  if (env.CODESPACES === 'true') {
    const name = env.CODESPACE_NAME || '';
    const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
    if (!/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) throw new Error('Codespaces must provide its name and forwarding domain.');
    return `https://${name}-8788.${domain}`;
  }
  return 'http://127.0.0.1:8788';
}

export function assertWorkspaceService(health, capabilities, revision) {
  if (health?.ok !== true || health.service !== 'funded-api') throw new Error('The app has not passed its HTTP health check.');
  if (capabilities?.cluster !== 'devnet' || capabilities.build !== revision || capabilities.sessions?.storage !== 'postgresql') {
    throw new Error('The running app does not match the requested Devnet revision and PostgreSQL configuration.');
  }
  if (health.external?.solanaKeeper !== false || health.external?.automaticRewards !== false) {
    throw new Error('The workspace app must have server signing and financial workers disabled.');
  }
}

function run(command, args, { capture = false, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Inspect the command output; credentials are not logged by this helper.`);
  return (result.stdout || '').trim();
}

async function secret(name, create) {
  const path = resolve(deployment, name);
  try { await writeFile(path, await create(), { flag: 'wx', mode: 0o644 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  // The containing directory is 0700. Container UID 1000 must read mounted files
  // even when the host developer uses another UID. Values never enter argv/env.
  return path;
}

function compose(settings, args) {
  return run('docker', ['compose', '--project-name', project, '--file', 'compose.devnet-release.yml', ...args], {
    env: { ...process.env, ...settings.selectors },
  });
}

async function start() {
  run('docker', ['info', '--format', '{{.ServerVersion}}']);
  const revision = run('git', ['rev-parse', 'HEAD'], { capture: true });
  if (run('git', ['status', '--porcelain'], { capture: true })) throw new Error('Commit or stash source edits before deploying a revision-labelled image.');
  const origin = workspaceOrigin(process.env);
  await mkdir(deployment, { recursive: true, mode: 0o700 });
  await chmod(deployment, 0o700);
  const passwordPath = await secret('database-password', () => randomBytes(32).toString('hex'));
  const databasePath = await secret('database-url', async () => `postgresql://funded:${(await readFile(passwordPath, 'utf8')).trim()}@db:5432/funded_app`);
  const tokenPath = await secret('api-token', () => randomBytes(32).toString('hex'));
  const rpcPath = await secret('devnet-rpc-url', () => 'https://api.devnet.solana.com');
  let previous;
  try { previous = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let image = previous?.revision === revision && previous?.origin === origin ? previous.selectors.FUNDED_APP_IMAGE : null;
  if (image) {
    const exists = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    if (exists.status !== 0) image = null;
  }
  if (!image) {
    const tag = `funded-devnet:workspace-${revision.slice(0, 12)}`;
    const build = ['build', '--tag', tag, '--build-arg', `FUNDED_SOURCE_REVISION=${revision}`, '--build-arg', `VITE_DEVNET_METADATA_ORIGIN=${origin}`];
    if (process.env.CODEX_PROXY_CERT) build.push('--secret', `id=proxy_ca,src=${process.env.CODEX_PROXY_CERT}`);
    run('docker', [...build, '.']);
    image = run('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { capture: true });
  }
  const settings = { revision, origin, selectors: {
    FUNDED_APP_IMAGE: image, FUNDED_BUILD_ID: revision, FUNDED_PUBLIC_APP_URL: origin,
    FUNDED_DEVNET_METADATA_ORIGIN: origin, FUNDED_PREVIEW_PORT: '8788',
    FUNDED_DB_PASSWORD_FILE: passwordPath, FUNDED_DATABASE_URL_FILE: databasePath,
    FUNDED_API_TOKEN_FILE: tokenPath, FUNDED_DEVNET_RPC_URL_FILE: rpcPath,
  } };
  // Persist selectors before startup, so status/stop also work after a failed start.
  await writeFile(stateFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  compose(settings, ['up', '--detach', '--wait', '--wait-timeout', '180']);
  const [health, capabilities] = await Promise.all(['/api/health', '/api/capabilities'].map(async path => {
    const response = await fetch(`http://127.0.0.1:8788${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('The app has not passed its HTTP identity and health checks.');
    return response.json();
  }));
  assertWorkspaceService(health, capabilities, revision);
  console.log(`Funded Devnet is running: ${origin}\nSource: ${revision}\nFinancial workers and server signing are disabled.`);
}

async function main(mode) {
  if (mode === 'start') return start();
  if (!['status', 'stop'].includes(mode)) throw new Error('Use start, status, or stop. Stop preserves the database volumes.');
  const settings = JSON.parse(await readFile(stateFile, 'utf8'));
  compose(settings, mode === 'stop' ? ['stop'] : ['ps']);
  if (mode === 'status') console.log(`App: ${settings.origin}\nSource: ${settings.revision}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
