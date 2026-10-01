import assert from 'node:assert/strict';
import { buybackQueue, verifiedBuybackAccruals } from '../server/buyback-executor.mjs';

const signature = 'verified-collection';
const mint = 'example-mint';
const at = '2026-09-18T00:00:00.000Z';
const state = {
  launches: { [mint]: { cluster: 'devnet', onchainVerified: true, creator: 'router', pumpFeeRoute: { scope: 'per-mint-v2', router: 'router' } } },
  collections: { [signature]: { signature, mint, cluster: 'devnet', status: 'collected', attribution: 'mint-verified', collectedLamports: 25_000_000_000, recordedAt: at } },
  settlements: { [signature]: { claimSignature: signature, claimedAt: at, fundedApp: { buyback: 0.25 } } },
  buybackOrders: {},
};
assert.equal(verifiedBuybackAccruals(state)[0].lamports, '250000000');
let queue = buybackQueue(state, new Date('2026-09-18T01:00:00.000Z'));
assert.equal(queue[0].eligible, true, 'threshold permits execution');
state.settlements[signature].fundedApp.buyback = 0.000001;
state.collections[signature].collectedLamports = 100000;
const priorCluster = process.env.SOLANA_CLUSTER, priorMint = process.env.FUNDED_QA_BUYBACK_MINT, priorWait = process.env.FUNDED_QA_BUYBACK_WAIT_SECONDS;
process.env.SOLANA_CLUSTER = 'devnet'; process.env.FUNDED_QA_BUYBACK_MINT = mint; process.env.FUNDED_QA_BUYBACK_WAIT_SECONDS = '60';
assert.equal(buybackQueue(state, new Date('2026-09-18T00:02:00.000Z'))[0].eligible, true, 'explicit Devnet QA mint can use a short wait');
process.env.SOLANA_CLUSTER = 'mainnet-beta';
assert.equal(buybackQueue(state, new Date('2026-09-18T00:02:00.000Z'))[0].eligible, false, 'short wait cannot activate on Mainnet');
for (const [key, value] of [['SOLANA_CLUSTER', priorCluster], ['FUNDED_QA_BUYBACK_MINT', priorMint], ['FUNDED_QA_BUYBACK_WAIT_SECONDS', priorWait]]) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
queue = buybackQueue(state, new Date('2026-09-18T07:00:00.000Z'));
assert.equal(queue[0].eligible, true, 'first accrual becomes eligible after six hours without a prior execution');
state.buybackOrders.existing = { id: 'existing', mint, status: 'submitted', settledLamports: '900' };
queue = buybackQueue(state, new Date('2026-09-18T07:00:00.000Z'));
assert.equal(queue[0].pendingLamports, '100');
assert.equal(queue[0].activeOrder, 'existing');
state.buybackOrders.existing = { id:'existing', mint, status:'finalized', settledLamports:'900', returnedLamports:'10', refundVerified:true };
queue = buybackQueue(state, new Date('2026-09-18T07:00:00.000Z'));
assert.equal(queue[0].pendingLamports, '110', 'verified refund remains in source router accrual');
assert.equal(queue[0].eligible, false, 'tiny post-execution residue waits for the next accrual');
state.collections[signature].attribution = 'unverified';
assert.equal(verifiedBuybackAccruals(state).length, 0, 'unverified collections cannot fund buybacks');
console.log('buyback executor accounting checks passed');
