import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bs58 from 'bs58';
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { createAutomaticRewardChain } from '../server/automatic-reward-chain.mjs';
import { createRewardScheduler } from '../server/reward-scheduler.mjs';
import { createHolderHistoryIndexer } from '../server/holder-history-indexer.mjs';

function signer() {
  const encoded = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim(), path = String(process.env.FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH || '').trim();
  if (encoded) return Keypair.fromSecretKey(bs58.decode(encoded));
  if (path) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(path), 'utf8'))));
  throw new Error('Reward authority is not configured.');
}
if (String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet') !== 'devnet') throw new Error('Reward pool funding is Devnet-only.');
const mint = new PublicKey(process.env.REWARD_MINT).toBase58(), asset = String(process.env.REWARD_ASSET || 'SOL'), amount = String(process.env.REWARD_AMOUNT || ''), sourceId = String(process.env.REWARD_SOURCE_ID || ''), kind = String(process.env.REWARD_KIND || 'holder');
if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || !sourceId) throw new Error('REWARD_AMOUNT must be positive base units and REWARD_SOURCE_ID is required.');
if (asset !== 'SOL' && new PublicKey(asset).toBase58() !== asset) throw new Error('REWARD_ASSET must be SOL or a canonical token mint.');
if (!['holder', 'creator', 'x', 'community', 'airdrop'].includes(kind)) throw new Error('REWARD_KIND must be holder, creator, x, community, or airdrop.');
const directRecipient = ['holder','airdrop'].includes(kind) ? null : new PublicKey(process.env.REWARD_RECIPIENT).toBase58();
const eligibilityMint = kind === 'airdrop' ? new PublicKey(process.env.REWARD_ELIGIBILITY_MINT).toBase58() : null;
if (kind === 'airdrop' && asset !== mint) throw new Error('An airdrop reward asset must be the launched coin mint.');
const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const holderIndexRpcUrl = process.env.SOLANA_HOLDER_INDEX_RPC_URL || rpcUrl;
const connection = new Connection(rpcUrl, 'finalized'), holderIndexConnection = new Connection(holderIndexRpcUrl, 'finalized'), authority = signer();
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const store = createAutomaticRewardStore(process.env.AUTOMATIC_REWARD_STORE_PATH || resolve(process.cwd(), 'data', 'automatic-rewards.json'));
const chain = createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256: process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
const indexer = createHolderHistoryIndexer({ connection:holderIndexConnection, store, rpcUrl:holderIndexRpcUrl }), scheduler = createRewardScheduler({ store, chain, indexer });
const ready = await chain.readiness(); if (!ready.constrainedPayouts) throw new Error(`Reward chain unavailable: ${ready.reasons.join(', ')}`);
const eligibilitySnapshot = kind === 'airdrop' ? await indexer.capture(eligibilityMint) : null;
let funding;
if (asset === 'SOL') funding = await chain.fundSolVaultFromMintRouter({ mint, amount, fundingId:sourceId });
else funding = await chain.fundTokenVault({ mint, asset, amount, decimals:Number(process.env.REWARD_TOKEN_DECIMALS) });
let scheduled;
if (kind === 'holder') {
  scheduled = await scheduler.recordFundedPool({ id:sourceId, mint, asset, amount, fundingSignature:funding.signature || `existing:${funding.claim}`, balanceDeltaVerified:funding.balanceDeltaVerified, fundedAt:Math.floor(Date.now()/1000) });
  await scheduler.register({ mint, asset, excludedWallets:String(process.env.REWARD_EXCLUDED_WALLETS || '').split(',').map(row=>row.trim()).filter(Boolean) });
} else if (kind === 'airdrop') {
  scheduled = await scheduler.recordSnapshotAirdrop({ id:sourceId, mint, eligibilityMint, asset, amount, snapshot:eligibilitySnapshot, excludedWallets:String(process.env.REWARD_EXCLUDED_WALLETS || '').split(',').map(row=>row.trim()).filter(Boolean), fundingSignature:funding.signature || `existing:${funding.tokenAccount}`, balanceDeltaVerified:funding.balanceDeltaVerified, fundedAt:Math.floor(Date.now()/1000) });
} else {
  scheduled = await scheduler.recordDirectFunded({ id:sourceId, mint, asset, kind, recipient:directRecipient, amount, fundingSignature:funding.signature || `existing:${funding.claim}`, balanceDeltaVerified:funding.balanceDeltaVerified, fundedAt:Math.floor(Date.now()/1000) });
}
console.log(JSON.stringify({ status:'funded', kind, scheduled, funding:{ ...funding, signature:funding.signature || null }, cluster:'devnet' }, null, 2));
