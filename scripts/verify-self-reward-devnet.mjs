import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { createAutomaticRewardChain } from '../server/automatic-reward-chain.mjs';
import { buildRewardManifest, createRewardCycleId } from '../reward-merkle.js';

assert.equal(String(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER), 'devnet', 'Devnet configuration is required.');
assert.equal(String(process.env.VITE_ALLOW_MAINNET || 'false'), 'false', 'Mainnet must remain disabled.');
const mint = new PublicKey(process.argv[2] || '');
const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const connection = new Connection(rpcUrl, 'finalized');
assert.equal(await connection.getGenesisHash(), await new Connection(clusterApiUrl('devnet'), 'finalized').getGenesisHash(), 'Configured RPC is not Devnet.');
const authority = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY));
const chain = createAutomaticRewardChain({
  connection,
  programId: new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID),
  authority,
  expectedProgramDataSha256: process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256,
});
assert((await chain.readiness()).constrainedPayouts, 'Reward contract readiness failed.');
const amount = '100000';
const funding = await chain.fundSolVault({ mint: mint.toBase58(), amount });
const now = Math.floor(Date.now() / 1000);
const cycleId = createRewardCycleId({ mint: mint.toBase58(), kind: 'creator', asset: 'SOL', periodStart: now - 120, periodEnd: now - 60 });
const manifest = buildRewardManifest({ cycleId, asset: 'SOL', allocations: [{ recipient: authority.publicKey.toBase58(), amount }] });
const plan = { mint: mint.toBase58(), cutoffAt: now - 60, payoutAt: now - 30, manifest };
const cycle = await chain.ensureCycle(plan);
const payout = await chain.submitLeaf(plan, manifest.leaves[0]);
assert(payout.finalized && payout.balanceDeltaVerified && payout.vaultBalanceDeltaVerified, 'Self-payout lacks finalized vault/cycle balance evidence.');
console.log(JSON.stringify({ status: 'passed', cluster: 'devnet', mint: mint.toBase58(), authority: authority.publicKey.toBase58(), fundingSignature: funding.signature, cycleSignature: cycle.signature, payoutSignature: payout.signature, payment: payout.payment, selfRecipient: true, vaultBalanceDeltaVerified: true }, null, 2));
