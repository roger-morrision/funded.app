import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bs58 from 'bs58';
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { rewardLedgerPath } from '../server/reward-ledger-path.mjs';
import { createHolderHistoryIndexer } from '../server/holder-history-indexer.mjs';
import { createAutomaticRewardChain, DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { createRewardScheduler } from '../server/reward-scheduler.mjs';
import { createRewardFundingProcessor } from '../server/reward-funding-processor.mjs';
import { rewardWorkerFailureStatus } from '../server/worker-readiness.mjs';
import { rpcQuotaExhausted, rpcWorkerWaitMs } from '../rpc-retry.js';

for (const [name, filePath] of Object.entries(process.env)) {
  if (!name.endsWith('_FILE') || !filePath || process.env[name.slice(0, -5)] != null) continue;
  process.env[name.slice(0, -5)] = readFileSync(filePath, 'utf8').trim();
}

function signer() {
  const cluster = String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet');
  const encoded = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim();
  const file = String(process.env.FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH || '').trim();
  if (encoded) return Keypair.fromSecretKey(bs58.decode(encoded));
  if (file) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(file), 'utf8'))));
  throw new Error('Reward scheduler authority is not configured.');
}

if (String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet') !== 'devnet') throw new Error('Automatic rewards are Devnet-only until an audited production release.');
const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const holderIndexRpcUrl = process.env.SOLANA_HOLDER_INDEX_RPC_URL || rpcUrl;
const connection = new Connection(rpcUrl, 'finalized');
const holderIndexConnection = new Connection(holderIndexRpcUrl, 'finalized');
const authority = signer();
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const store = createAutomaticRewardStore(rewardLedgerPath());
const chain = createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256: process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
const scheduler = createRewardScheduler({ store, chain, indexer: createHolderHistoryIndexer({ connection:holderIndexConnection, store, rpcUrl:holderIndexRpcUrl, expectedGenesisHash:DEVNET_GENESIS_HASH }) });
const fundingProcessor = createRewardFundingProcessor({ store, chain, scheduler });
const configs = JSON.parse(process.env.FUNDED_REWARD_PROGRAMS_JSON || '[]');
for (const config of configs) await scheduler.register(config);

const intervalMs = Math.max(30_000, Number(process.env.FUNDED_REWARD_TICK_MS || 60_000));
const runOnce = process.env.FUNDED_REWARD_ONCE === 'true';
let stopped = false;
process.once('SIGINT', () => { stopped = true; });
process.once('SIGTERM', () => { stopped = true; });
do {
  let waitMs = intervalMs;
  try { console.log(JSON.stringify({ at: new Date().toISOString(), funding:await fundingProcessor.processPending(), ...(await scheduler.tick()) })); }
  catch (error) {
    const quotaExhausted = rpcQuotaExhausted(error);
    if (quotaExhausted) {
      waitMs = rpcWorkerWaitMs(error, intervalMs);
    }
    await store.transaction(state => { state.serviceStatus = rewardWorkerFailureStatus({ quotaExhausted }); }).catch(() => {});
    console.error(JSON.stringify({ at: new Date().toISOString(), status: quotaExhausted ? 'rpc-quota-exhausted' : 'error',
      retryAfterMs: quotaExhausted ? waitMs : undefined, error: String(error.message || error) }));
  }
  if (runOnce) break;
  if (!stopped) await new Promise(resolveWait => setTimeout(resolveWait, waitMs));
} while (!stopped);
