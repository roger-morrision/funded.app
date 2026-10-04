import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// This free web profile has no background workers or server signing authority.
export function renderDevnetEnvironment(input) {
  const origin = new URL(input.PUBLIC_APP_URL || input.RENDER_EXTERNAL_URL || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Set PUBLIC_APP_URL or RENDER_EXTERNAL_URL to an HTTPS origin.');
  }
  for (const [key, value] of Object.entries(input)) {
    if (value && /(?:SECRET_KEY|KEYPAIR_PATH)(?:_FILE)?$/.test(key)) throw new Error(`Remove ${key}: this hosting profile does not accept signing keys.`);
  }
  const revision = input.RENDER_GIT_COMMIT || input.FUNDED_BUILD_ID;
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('A full Git commit is required for the hosted build identity.');
  return {
    ...input, FUNDED_SKIP_LOCAL_ENV: 'true', NODE_ENV: 'production', NODE_VERSION: '24', HOST: '0.0.0.0',
    FUNDED_BUILD_ID: revision, PUBLIC_APP_URL: origin.origin, CORS_ORIGIN: origin.origin,
    DEVNET_METADATA_ORIGIN: origin.origin, VITE_DEVNET_METADATA_ORIGIN: origin.origin,
    SOLANA_CLUSTER: 'devnet', VITE_SOLANA_CLUSTER: 'devnet', VITE_EXPLORE_CLUSTER: 'devnet',
    VITE_API_BASE_URL: '/', VITE_ALLOW_MAINNET: 'false', VITE_DEV_MODE: 'false', VITE_DEV_AUTOCONNECT: 'false',
    DEV_MODE: 'false', DEVNET_TEST_MODE: 'false', SOLANA_KEEPER_CONFIGURED: 'false',
    SOLANA_REFERRAL_PAYOUT_CONFIGURED: 'false', FUNDED_MINT_FEE_ROUTER_ENABLED: 'false',
    FUNDED_BUYBACK_EXECUTOR_ENABLED: 'false', FUNDED_BOOST_ENABLED: 'false', VITE_JACKPOT_ENABLED: 'false',
    RPC_ALLOW_AIRDROP: 'false', RPC_ALLOW_EXPENSIVE_METHODS: 'false', TRUST_PROXY: 'false',
    DATABASE_SSL: 'true', SOLANA_RPC_URL: input.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  };
}

export function assertRenderBuildIdentity(env, built, release) {
  if (built?.origin !== env.PUBLIC_APP_URL || built?.revision !== env.FUNDED_BUILD_ID || built?.cluster !== 'devnet') {
    throw new Error('Hosting origin or revision changed: rebuild before starting.');
  }
  if (release?.source !== env.FUNDED_BUILD_ID || release?.releaseEligible !== true || release?.dirty !== false
    || release?.cluster !== 'devnet' || release?.mainnetEnabled !== false
    || release?.builtSettings?.cluster !== 'devnet' || release?.builtSettings?.exploreCluster !== 'devnet'
    || release?.builtSettings?.devWalletEnabled !== false || release?.builtSettings?.mainnetEnabled !== false) {
    throw new Error('A clean Devnet release manifest matching the hosted commit with test-wallet signing disabled is required. Rebuild before starting.');
  }
}

export function assertRenderRuntimeConfig(env) {
  if (!env.DATABASE_URL || env.FUNDED_STORE_PATH) throw new Error('A PostgreSQL DATABASE_URL is required; local file storage is not supported on this host.');
  let db;
  try { db = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
  if (String(env.FUNDED_API_TOKEN || '').trim().length < 32) throw new Error('A generated FUNDED_API_TOKEN of at least 32 characters is required.');
}

async function main(mode) {
  const env = renderDevnetEnvironment(process.env);
  Object.assign(process.env, env);
  if (mode === '--build') {
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (sourceRevision !== env.FUNDED_BUILD_ID) throw new Error('Render commit does not match the checked-out source. Rebuild from the intended commit.');
    const run = (command, args) => {
      const result = spawnSync(command, args, { env, stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error(`${command} failed during the hosted build.`);
    };
    run('npm', ['run', 'build']);
    await writeFile('dist/hosting-settings.json', JSON.stringify({ origin: env.PUBLIC_APP_URL, revision: env.FUNDED_BUILD_ID, cluster: 'devnet' }) + '\n');
    run(process.execPath, ['scripts/release-manifest.mjs']);
  } else if (mode === '--start') {
    const built = JSON.parse(await readFile('dist/hosting-settings.json', 'utf8'));
    const release = JSON.parse(await readFile('dist/release.json', 'utf8'));
    assertRenderBuildIdentity(env, built, release);
    assertRenderRuntimeConfig(env);
    const { createPostgresStore } = await import('../server/postgres-store.mjs');
    const store = createPostgresStore(env.DATABASE_URL);
    try { await store.read(); } finally { await store.close(); }
    await import('../server/index.mjs');
  } else throw new Error('Use --build or --start.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2]);
}
