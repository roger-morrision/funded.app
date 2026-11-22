// Runs inside the local SBF regression. All inputs are public fixture addresses.
import assert from 'node:assert/strict';
import { buildDailyBonusSnapshot, dailyBonusManifest } from '../../../../../../server/daily-bonus.mjs';
import { verifyRewardProof } from '../../../../../../reward-merkle.js';

const [mint, creator, winner, runnerUp] = process.argv.slice(2);
const start = Date.UTC(2026, 10, 20) / 1000;
const collection = {
  signature: 'fixture-collection', settlementSignature: 'fixture-settlement', mint, creator,
  amountLamports: '3000', communityLamports: '600', dailyBonusVersion: 1, finalized: true, blockTime: start
};
const trade = (wallet, signature, amountLamports) => ({
  wallet, mint, signature, amountLamports, logIndex: 0, blockTime: start, finalized: true
});
const trades = [trade(winner, 'a', '30'), trade(runnerUp, 'b', '60'), trade(winner, 'c', '40')];
function snapshot(events) {
  return buildDailyBonusSnapshot({ day: '2026-11-20', now: start + 86400, collections: [collection],
    coverage: [{ mint, complete: true }], trades: events });
}
const original = snapshot(trades);
const source = original.sources[0];
assert.deepEqual(original.rankings.traders.map(row => row.wallet), [winner, runnerUp]);
assert.deepEqual([source.payableLamports, source.retainedLamports], ['260', '340']);
const manifest = dailyBonusManifest(original, source);
for (const first of trades) {
  for (const second of trades.filter(t => t !== first)) {
    const third = trades.find(t => t !== first && t !== second);
    assert.deepEqual(snapshot([first, second, third]), original);
  }
}
const leaf = manifest.leaves.find(row => row.recipient === winner);
assert.equal(leaf.amount, '100');
assert(verifyRewardProof({ ...manifest, ...leaf }));
console.log(JSON.stringify({ cutoff: original.end, root: manifest.root, cycleId: manifest.cycleId,
  leafIndex: leaf.index, proof: leaf.proof }));
