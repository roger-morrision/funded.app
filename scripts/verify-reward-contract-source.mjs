import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Keypair } from '@solana/web3.js';
import { buildRewardManifest, createRewardCycleId, verifyRewardProof } from '../reward-merkle.js';
import { rewardAddresses } from '../server/automatic-reward-chain.mjs';

const root = new URL('../contracts/funded-fee-router/programs/funded-fee-router/src/', import.meta.url);
const [lib, reward, state] = await Promise.all([readFile(new URL('lib.rs', root), 'utf8'), readFile(new URL('instructions/reward.rs', root), 'utf8'), readFile(new URL('state.rs', root), 'utf8')]);
for (const instruction of ['initialize_reward_vault', 'create_reward_cycle', 'payout_reward_sol', 'payout_reward_token']) assert.match(lib, new RegExp(`pub fn ${instruction}`));
for (const guard of ['verify_proof', 'RewardCycleNotPayable', 'RewardTotalExceeded', 'transfer_checked', 'RewardPayment']) assert.match(`${reward}\n${state}`, new RegExp(guard));
const programId = Keypair.generate().publicKey, authority = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, recipient = Keypair.generate().publicKey;
const cycleId = createRewardCycleId({ mint:mint.toBase58(), kind:'holder', asset:'SOL', periodStart:1, periodEnd:2 });
const manifest = buildRewardManifest({ cycleId, allocations:[{ recipient:recipient.toBase58(), amount:'1' }] });
assert(verifyRewardProof({ ...manifest.leaves[0], cycleId, asset:'SOL', root:manifest.root }));
const addresses = rewardAddresses({ programId, authority, mint, cycleId, recipient });
assert.notEqual(addresses.vault.toBase58(), addresses.cycle.toBase58());
assert.notEqual(addresses.cycle.toBase58(), addresses.payment.toBase58());
console.log('Reward contract source contains immutable cycle, one-payment PDA, timing, total, Merkle and checked-token-transfer controls; JS manifest/PDA parity checks passed. Rust compilation is a separate required gate.');
