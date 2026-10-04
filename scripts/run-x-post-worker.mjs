import { readFile, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Connection } from '@solana/web3.js';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { rewardLedgerPath } from '../server/reward-ledger-path.mjs';
import { createXPostStore } from '../server/x-post-store.mjs';
import { runXPostWorker } from '../server/x-post-worker.mjs';
import { createXPublisher } from '../server/x-post-client.mjs';
import { buildXPost } from '../server/x-post-content.mjs';
import { collectXPostEvents, createXPostChainAdapters } from '../server/x-post-events.mjs';
import { createXProfitVerifier } from '../server/x-profit-proof.mjs';

function numberSetting(value, fallback, min, max, name) {
  const result = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} is outside its supported range.`);
  return result;
}

export function xWorkerConfig(env, args = []) {
  if (args.some(arg => !['--once', '--loop', '--status', '--execute'].includes(arg)) || args.filter(arg => ['--once', '--loop', '--status'].includes(arg)).length > 1) {
    throw new Error('Use --once, --loop, or --status; add --execute only for authorized live publication.');
  }
  const cluster = env.SOLANA_CLUSTER || env.VITE_SOLANA_CLUSTER || 'devnet';
  if (cluster !== 'devnet') throw new Error('The verified event collector is Devnet-only; mainnet publication is not available.');
  const handle = String(env.X_POST_EXPECTED_HANDLE || '').replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) throw new Error('Set X_POST_EXPECTED_HANDLE to the intended platform account.');
  let origin;
  try { origin = new URL(env.X_POST_PUBLIC_ORIGIN || ''); } catch { throw new Error('Set X_POST_PUBLIC_ORIGIN to the public HTTPS app origin.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !/^[a-z0-9.-]+$/i.test(origin.hostname) || !origin.hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(origin.hostname)
    || /(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(origin.hostname)) {
    throw new Error('X_POST_PUBLIC_ORIGIN must be a public HTTPS hostname without credentials or a path.');
  }
  const start = Date.parse(env.X_POST_START_AT || '');
  if (!Number.isFinite(start) || start > Date.now()) throw new Error('Set X_POST_START_AT to an explicit activation timestamp at or before now.');
  if (!env.DATABASE_URL) throw new Error('A PostgreSQL DATABASE_URL is required for durable X delivery state.');
  try { if (!['postgres:', 'postgresql:'].includes(new URL(env.DATABASE_URL).protocol)) throw new Error(); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.'); }
  const execute = args.includes('--execute');
  if (execute && env.X_POST_ENABLED !== 'true') throw new Error('Live publication requires X_POST_ENABLED=true as well as --execute.');
  if (execute && env.X_POST_ALLOW_DEVNET !== 'true') throw new Error('Public Devnet posts require explicit X_POST_ALLOW_DEVNET=true authorization.');
  if (execute && !env.X_POST_ACCESS_TOKEN) throw new Error('Configure a separate X_POST_ACCESS_TOKEN for the selected account.');
  const minProfitLamports = env.X_POST_MIN_PROFIT_LAMPORTS || '1000000000';
  if (!/^[1-9]\d{0,19}$/.test(minProfitLamports)) throw new Error('X_POST_MIN_PROFIT_LAMPORTS must be positive integer lamports.');
  return {
    mode: args.includes('--status') ? 'status' : args.includes('--loop') ? 'loop' : 'once', execute, cluster, handle,
    origin: origin.origin, enabledAt: new Date(start).toISOString(), minProfitLamports,
    intervalMs: numberSetting(env.X_POST_INTERVAL_MS, 60_000, 10_000, 3_600_000, 'X_POST_INTERVAL_MS'),
    maxPosts: numberSetting(env.X_POST_MAX_PER_PASS, 1, 1, 20, 'X_POST_MAX_PER_PASS'),
    maxHourlyPosts: numberSetting(env.X_POST_MAX_HOURLY, 6, 1, 60, 'X_POST_MAX_HOURLY'),
    maxDailyPosts: numberSetting(env.X_POST_MAX_DAILY, 24, 1, 1440, 'X_POST_MAX_DAILY'),
  };
}

async function loadSecrets(env, execute) {
  const loaded = { ...env };
  // Deliberate whitelist: no local env files, signing keys or creator OAuth keys.
  for (const name of ['DATABASE_URL', 'SOLANA_RPC_URL', ...(execute ? ['X_POST_ACCESS_TOKEN'] : [])]) {
    if (!loaded[name] && loaded[`${name}_FILE`]) loaded[name] = (await readFile(loaded[`${name}_FILE`], 'utf8')).trim();
  }
  return loaded;
}

async function verifyPublicApp(config) {
  let response, body;
  try {
    response = await fetch(`${config.origin}/api/capabilities`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    body = await response.json();
  } catch { throw new Error('The public app is unreachable; X publication stays blocked.'); }
  if (!response.ok || body.cluster !== config.cluster || body.sessions?.storage !== 'postgresql') {
    throw new Error('The public app does not identify the expected network and durable storage.');
  }
}

export async function runXPostCycle({ config, store, mainStore, readRewards, adapters, publish, now = Date.now() }) {
  const checkpoint = await store.readCursor();
  const [state, rewardState] = await Promise.all([mainStore.read(), readRewards()]);
  const collected = await collectXPostEvents({ state, rewardState, enabledAt: config.enabledAt, now,
    cursor: checkpoint.cursor, adapters: { ...adapters, isKnownEvent: id => store.has(id) }, minProfitLamports: config.minProfitLamports });
  // Any formatting failure leaves the entire cursor unchanged for investigation.
  const events = collected.events.map(event => ({ id: event.id, occurredAt: event.occurredAt,
    ...buildXPost(event.kind, event.payload, { cluster: event.cluster, publicOrigin: config.origin, minProfitLamports: config.minProfitLamports }) }));
  await store.enqueueBatch(events, { cursor: collected.cursor, version: checkpoint.version });
  const checkedPublish = async (event, options) => {
    if (event.cluster !== config.cluster) throw Object.assign(new Error('Queued X event does not match the configured network.'), { delivery: 'rejected' });
    return publish(event, options);
  };
  const dispatch = await runXPostWorker({ store, publish: checkedPublish, enabled: true, dryRun: !config.execute, maxPosts: config.maxPosts });
  return { mode: config.execute ? 'dispatch' : 'draft', account: config.handle, cluster: config.cluster,
    collected: events.length, sourceGaps: collected.sourceGaps, dispatch };
}

async function main(args) {
  const env = await loadSecrets(process.env, args.includes('--execute'));
  const config = xWorkerConfig(env, args);
  const outbox = createXPostStore({ databaseUrl: env.DATABASE_URL, accountId: config.handle,
    maxHourlyPosts: config.maxHourlyPosts, maxDailyPosts: config.maxDailyPosts });
  let mainStore;
  let stopping = false;
  let wake;
  const stop = () => { stopping = true; wake?.(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await outbox.init();
    if (config.mode === 'status') {
      const rows = await outbox.list({ limit: 50 });
      console.log(JSON.stringify({ account: config.handle, events: rows }, null, 2));
      return;
    }
    const publisher = config.execute ? createXPublisher({ accessToken: env.X_POST_ACCESS_TOKEN,
      expectedHandle: config.handle, expectedAccountId: env.X_POST_ACCOUNT_ID }) : null;
    mainStore = createPostgresStore(env.DATABASE_URL);
    const connection = new Connection(env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', { commitment: 'finalized', disableRetryOnRateLimit: true,
      fetch: (url, options) => fetch(url, { ...options, signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }) });
    const adapters = createXPostChainAdapters({ connection, fundedMint: env.FUNDED_TOKEN_MINT || env.VITE_FUNDED_TOKEN_MINT,
      programId: env.FUNDED_FEE_ROUTER_PROGRAM_ID || env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID,
      rewardAuthority: env.FUNDED_REWARD_AUTHORITY });
    adapters.verifyPublicClosedTrade = createXProfitVerifier({ connection, publicOrigin: config.origin, xAccount: config.handle,
      appFeeRecipient: env.FUNDED_TRADE_FEE_OWNER || env.VITE_FUNDED_TRADE_FEE_OWNER || null });
    const ledger = rewardLedgerPath(env);
    const readRewards = async () => {
      try { await access(ledger); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      return createAutomaticRewardStore(ledger).read();
    };
    do {
      try {
        if (publisher) { await verifyPublicApp(config); await publisher.verifyAccount(); }
        const report = await runXPostCycle({ config, store: outbox, mainStore, readRewards, adapters,
          publish: publisher ? (event, options) => publisher.publish(event, options) : undefined });
        console.log(JSON.stringify({ at: new Date().toISOString(), ...report }));
      } catch (error) {
        console.error(JSON.stringify({ status: 'blocked', reason: error.message }));
        if (config.mode !== 'loop') throw error;
      }
      if (config.mode !== 'loop' || stopping) break;
      await new Promise(resolve => { const timer = setTimeout(resolve, config.intervalMs); wake = () => { clearTimeout(timer); resolve(); }; });
    } while (!stopping);
  } finally {
    await mainStore?.close(); await outbox.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
