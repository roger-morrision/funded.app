import { Connection } from '@solana/web3.js';
import { indexCommunityClaims } from './community-claim-index.mjs';
import { pruneShareVisits } from './share-visits.mjs';

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
  env = process.env, scheduleTimeout = setTimeout, scheduleInterval = setInterval,
  createConnection = url => new Connection(url, 'finalized'),
  indexClaims = indexCommunityClaims, logger = console,
}) {
  if (solanaCluster !== 'devnet' || !fundedTokenMint || !env.FUNDED_REWARD_AUTHORITY
    || !env.FUNDED_FEE_ROUTER_PROGRAM_ID || !env.FUNDED_REWARD_PROGRAM_DATA_SHA256) return;
  let indexing = false;
  const refreshCommunityClaimIndex = async () => {
    if (indexing) return;
    indexing = true;
    try {
      const result = await indexClaims({ connection: createConnection(solanaRpcUrl),
        ledger: automaticRewardStore, programId: env.FUNDED_FEE_ROUTER_PROGRAM_ID,
        authority: env.FUNDED_REWARD_AUTHORITY, eligibilityMint: fundedTokenMint,
        expectedProgramDataSha256: env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
      logger.log(JSON.stringify({ event: 'community_claim_indexed', drops: result.drops.length,
        claims: result.payments.length, indexedAt: result.indexedAt }));
    } catch (error) {
      logger.error(JSON.stringify({ event: 'community_claim_index_failed', reason: String(error.message || error).slice(0, 180) }));
    } finally { indexing = false; }
  };
  scheduleTimeout(() => { void refreshCommunityClaimIndex(); }, 5_000).unref();
  scheduleInterval(() => { void refreshCommunityClaimIndex(); }, 3 * 60_000).unref();
}
