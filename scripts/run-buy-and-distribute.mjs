import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bs58 from 'bs58';
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { createAutomaticRewardChain } from '../server/automatic-reward-chain.mjs';
import { createRewardScheduler } from '../server/reward-scheduler.mjs';
import { createBuyAndDistributeExecutor } from '../server/buy-and-distribute.mjs';

function signer() {
  const cluster = String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet');
  const encoded = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || (cluster === 'devnet' ? process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY : '') || '').trim(), path = String(process.env.FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH || '').trim();
  if (encoded) return Keypair.fromSecretKey(bs58.decode(encoded));
  if (path) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(path), 'utf8'))));
  throw new Error('Reward authority is not configured.');
}
if (String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet') !== 'devnet') throw new Error('Buy-and-distribute is Devnet-only.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized'), authority = signer();
const mint = new PublicKey(process.env.REWARD_MINT).toBase58(), programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const store = createAutomaticRewardStore(process.env.AUTOMATIC_REWARD_STORE_PATH || resolve(process.cwd(), 'data', 'automatic-rewards.json'));
const chain = createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256:process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
const scheduler = createRewardScheduler({ store, chain, indexer:{ capture:async()=>{ throw new Error('Indexer is not used by the buy command.'); } } });
await scheduler.register({ mint, asset:mint, excludedWallets:String(process.env.REWARD_EXCLUDED_WALLETS || '').split(',').map(row=>row.trim()).filter(Boolean) });
const executor = createBuyAndDistributeExecutor({ connection, authority, feeOwner:new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER).toBase58(), feeBps:Number(process.env.FUNDED_TRADE_FEE_BPS || 50), store, rewardChain:chain, scheduler });
const result = await executor.execute({ enabled:process.env.BUY_DISTRIBUTE_ENABLED === 'true', mint, sourceId:process.env.REWARD_SOURCE_ID, budgetLamports:process.env.REWARD_AMOUNT, maxBudgetLamports:process.env.BUY_DISTRIBUTE_MAX_LAMPORTS, slippagePercent:Number(process.env.BUY_DISTRIBUTE_SLIPPAGE_PERCENT || 1), maxPriceImpactPercent:Number(process.env.BUY_DISTRIBUTE_MAX_PRICE_IMPACT_PERCENT || 3) });
console.log(JSON.stringify({ status:result.status, order:result, cluster:'devnet' }, null, 2));
