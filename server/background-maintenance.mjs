import { Connection } from '@solana/web3.js';
import { indexCommunityClaims } from './community-claim-index.mjs';
import { pruneShareVisits } from './share-visits.mjs';
import { createAutomaticRewardChain, DEVNET_GENESIS_HASH } from './automatic-reward-chain.mjs';
import { createHolderHistoryIndexer } from './holder-history-indexer.mjs';
import { createRewardScheduler } from './reward-scheduler.mjs';
import { createHolderRewardQuoteReader } from './holder-reward-quote.mjs';
import { QA_HOLDER_POLICY, qaHolderMinimums } from './devnet-qa-minimums.mjs';

// The first cleanup must finish before the HTTP server starts accepting requests.
export async function startShareVisitCleanup({ store, scheduleInterval = setInterval, logger = console }) {
  async function pruneStoredShareVisits() {
    const state = await store.read();
    const expired = pruneShareVisits(structuredClone(state.shareVisits || {}));
    if (expired) await store.update(current => pruneShareVisits(current.shareVisits ||= {}));
  }
  await pruneStoredShareVisits();
  scheduleInterval(() => {
    void pruneStoredShareVisits().catch(error => logger.error('Share visit cleanup failed:', error));
  }, 24 * 60 * 60 * 1000).unref();
}

export function startCommunityClaimIndex({
  solanaCluster, solanaRpcUrl, fundedTokenMint, automaticRewardStore,
  v3AuthorityKeypair,
  env = process.env, scheduleTimeout = setTimeout, scheduleInterval = setInterval,
  createConnection = url => new Connection(url, 'finalized'),
  indexClaims = indexCommunityClaims, logger = console,
}) {
  let authority;
  try { authority = v3AuthorityKeypair?.()?.publicKey?.toBase58(); } catch { return; }
  if (solanaCluster !== 'devnet' || !fundedTokenMint || !authority
    || !env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID
    || !/^[a-f0-9]{64}$/i.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || ''))) return;
  let indexing = false;
  const refreshCommunityClaimIndex = async () => {
    if (indexing) return;
    indexing = true;
    try {
      const result = await indexClaims({ connection: createConnection(solanaRpcUrl),
        ledger: automaticRewardStore, programId: env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,
        authority, eligibilityMint: fundedTokenMint,
        expectedProgramDataSha256: env.FUNDED_V3_PROGRAM_DATA_SHA256 });
      logger.log(JSON.stringify({ event: 'community_claim_indexed', drops: result.drops.length,
        claims: result.payments.length, indexedAt: result.indexedAt }));
    } catch (error) {
      logger.error(JSON.stringify({ event: 'community_claim_index_failed', reason: String(error.message || error).slice(0, 180) }));
    } finally { indexing = false; }
  };
  scheduleTimeout(() => { void refreshCommunityClaimIndex(); }, 5_000).unref();
  scheduleInterval(() => { void refreshCommunityClaimIndex(); }, 3 * 60_000).unref();
}

export function startV3HolderRewardWorker({ solanaCluster, solanaRpcUrl,
  automaticRewardStore, v3AuthorityKeypair, env = process.env,
  scheduleTimeout = setTimeout, scheduleInterval = setInterval,
  createConnection = url => new Connection(url, 'finalized'), logger = console }) {
  if (solanaCluster !== 'devnet' || env.FUNDED_V3_HOLDER_WORKER_ENABLED !== 'true'
    || !env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID
    || !/^[a-f0-9]{64}$/i.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '')))
    return false;
  let authority;
  try { authority = v3AuthorityKeypair(); } catch { return false; }
  if (!authority?.publicKey) return false;
  const connection = createConnection(solanaRpcUrl);
  const holderRpcUrl = env.SOLANA_HOLDER_INDEX_RPC_URL || solanaRpcUrl;
  const holderConnection = createConnection(holderRpcUrl);
  const chain = createAutomaticRewardChain({ connection,
    programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID, authority,
    expectedProgramDataSha256:env.FUNDED_V3_PROGRAM_DATA_SHA256 });
  const indexer = createHolderHistoryIndexer({ connection:holderConnection,
    store:automaticRewardStore, rpcUrl:holderRpcUrl,
    expectedGenesisHash:DEVNET_GENESIS_HASH });
  const scheduler = createRewardScheduler({ store:automaticRewardStore, chain, indexer,
    quoteReader:createHolderRewardQuoteReader({ connection:holderConnection, env }) });
  const migrateFundedV3Programs = async () => {
    const state = await automaticRewardStore.read();
    const fundedMints = new Set(Object.values(state.rewardPools || {})
      .filter(pool => String(pool.id).startsWith('v3:') && pool.asset === 'SOL')
      .map(pool => pool.mint));
    for (const config of Object.values(state.programs || {})) {
      if (!fundedMints.has(config.mint) || config.asset !== 'SOL') continue;
      const qaMinimums = qaHolderMinimums(config.mint, solanaCluster, env);
      const eligibilityPolicy = qaMinimums ? QA_HOLDER_POLICY : 'usd-20-hourly-v1';
      const shortQa = env.FUNDED_QA_SHORT_REWARD_PERIODS === 'true'
        && env.FUNDED_QA_HOLDER_MINT === config.mint && config.periodSeconds === 300;
      const periodSeconds = shortQa ? 300 : 3600;
      if (config.periodSeconds === periodSeconds
        && config.eligibilityPolicy === eligibilityPolicy
        && JSON.stringify(config.qaMinimums || null) === JSON.stringify(qaMinimums)) continue;
      const now = Math.floor(Date.now() / 1000);
      const policyChanged = config.eligibilityPolicy !== eligibilityPolicy
        || JSON.stringify(config.qaMinimums || null) !== JSON.stringify(qaMinimums);
      await scheduler.register({ ...config, periodSeconds,
        sampleIntervalSeconds:300, payoutDelaySeconds:0,
        eligibilityPolicy, qaMinimums,
        firstPeriodStart:config.periodSeconds === periodSeconds && !policyChanged
          ? config.firstPeriodStart
          : Math.ceil(now / periodSeconds) * periodSeconds });
    }
  };
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await migrateFundedV3Programs();
      const result = await scheduler.tick();
      logger.log(JSON.stringify({ event:'v3_holder_reward_tick',
        status:result.status, submitted:result.submitted,
        captured:result.captured }));
    } catch (error) {
      logger.error(JSON.stringify({ event:'v3_holder_reward_tick_failed',
        reason:String(error.message || error).slice(0, 180) }));
    } finally { running = false; }
  };
  scheduleTimeout(() => { void tick(); }, 5_000).unref();
  scheduleInterval(() => { void tick(); }, 60_000).unref();
  return true;
}
