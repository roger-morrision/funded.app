import assert from 'node:assert/strict';
import { allocateProRataRewards, buildRewardCycle, validateRewardConfig } from '../reward-policy.js';
import { analyzeLaunchActivity } from '../anti-sniper-policy.js';
import { buildProductionReadiness, isKeeperEnabled } from '../production-readiness.js';

assert.equal(validateRewardConfig({ transferFeeBps: 100 }).valid, true);
assert.equal(validateRewardConfig({ transferFeeBps: 200 }).valid, false);
const rewards = allocateProRataRewards({ distributableAmount: 97.5, holders: [{ wallet: 'A', balance: 70, valueUsd: 100 }, { wallet: 'B', balance: 30, valueUsd: 50 }, { wallet: 'dust', balance: 1000, valueUsd: 1 }] });
assert.equal(rewards.eligibleHolders, 2);
assert.ok(Math.abs(rewards.payouts.reduce((sum, payout) => sum + payout.amount, 0) - 97.5) < 0.000001);
assert.equal(buildRewardCycle({ cycleSignature: 'cycle-1', transferFeeBps: 300, withheldAmount: 100, holders: [{ wallet: 'A', balance: 1, valueUsd: 25 }] }).status, 'ready-to-payout');
const review = analyzeLaunchActivity({ creatorWallet: 'creator', launchTimestamp: 100, trades: [{ timestamp: 101, wallet: 'A', funder: 'f', slot: 1 }, { timestamp: 102, wallet: 'B', funder: 'f', slot: 1 }, { timestamp: 103, wallet: 'C', funder: 'f', slot: 1 }] });
assert.equal(review.status, 'review');
assert.ok(review.flags.includes('funding-cluster'));
assert.equal(buildProductionReadiness({}).ready, false);
for (const value of [undefined, false, true, 'false', 'TRUE', '0', '', 'yes']) assert.equal(isKeeperEnabled({SOLANA_KEEPER_CONFIGURED:value}),false);
assert.equal(isKeeperEnabled({SOLANA_KEEPER_CONFIGURED:'true'}),true);
const configured = { VITE_SOLANA_CLUSTER: 'mainnet-beta', SOLANA_RPC_URL: 'https://rpc.example.org',
  FUNDED_FEE_ROUTER_PROGRAM_ID: 'configured', SOLANA_KEEPER_CONFIGURED: 'true', SOLANA_KEEPER_SECRET_KEY: 'private-test-value',
  DATABASE_URL: 'postgres://configured', BIRDEYE_API_KEY: 'private-test-value', FUNDED_REWARD_PROGRAM_ID: 'configured',
  FUNDED_COMMUNITY_VAULT_PROGRAM_ID: 'configured', X_ATTESTATION_SECRET: 'private-test-value' };
const report = buildProductionReadiness(configured);
assert.equal(report.configurationComplete, true);
assert.equal(report.ready, false, 'Presence is not evidence of operational readiness.');
assert.ok(report.checks.every(check => check.status === 'configured-unverified' && !check.ready));
assert.ok(!JSON.stringify(report).includes('private-test-value'));
for (const value of ['false', '0', '', 'yes']) assert.ok(buildProductionReadiness({ ...configured, SOLANA_KEEPER_CONFIGURED: value }).missing.includes('keeper'));
for (const url of ['http://localhost:8899', 'https://api.devnet.solana.com', 'not-a-url']) assert.ok(buildProductionReadiness({ ...configured, SOLANA_RPC_URL: url }).missing.includes('productionRpc'));
assert.ok(buildProductionReadiness({ ...configured, VITE_SOLANA_CLUSTER: 'devnet' }).missing.includes('productionRpc'));
assert.ok(buildProductionReadiness({ ...configured, FUNDED_STORE_PATH: 'local.json' }).missing.includes('persistentStore'));
console.log('production policy checks passed');
