import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { buildDailyBonusSnapshot, dailyBonusWindow, dailyBonusManifest } from '../server/daily-bonus.mjs';
import { verifyRewardProof } from '../reward-merkle.js';
import {setActiveProtocolFeeSplit,FEE_DISTRIBUTION} from '../distribution-policy.js';
import {PROTOCOL_FEE_SPLIT} from '../config/protocol-fee-split.js';
import {agencyProtocolSplit} from '../agency-mint-router-v3.js';
import {currentFeePolicyCopy} from '../src/features/fees/fee-policy-copy.js';

export const wallets = Array.from({ length:12 }, (_, n) => Keypair.fromSeed(new Uint8Array(32).fill(n + 1)).publicKey.toBase58());
export function bonusFixture() {
  const day = '2026-10-17', start = Date.parse(`${day}T00:00:00Z`) / 1000;
  return { day, now:start + 86_400,
    coverage:[{ mint:wallets[9], complete:true, routes:1 }],
    collections:[0, 1, 2].map(n => ({ signature:`collection-${n}`, settlementSignature:`settlement-${n}`,
      mint:wallets[9], creator:wallets[n], referrer:wallets[n + 3], blockTime:start + n,
      finalized:true, amountLamports:String((n + 1) * 100_000), communityLamports:n === 0 ? '3000' : '0',
      dailyBonusVersion:n === 0 ? 1 : null })),
    trades:[0, 1, 2].map(n => ({ signature:`trade-${n}`, logIndex:n, mint:wallets[9], wallet:wallets[n + 6],
      blockTime:start + n, finalized:true, amountLamports:String((n + 1) * 200_000) })) };
}
test('daily bonus closes at UTC midnight and uses exact thirds with 50/30/20 ranks', () => {
  const input = bonusFixture(), snapshot = buildDailyBonusSnapshot(input);
  assert.equal(dailyBonusWindow(input.day, input.now).end, input.now);
  assert.throws(() => dailyBonusWindow(input.day, input.now - 1), /completed UTC day/);
  for (const group of ['creators', 'referrals', 'traders']) {
    assert.deepEqual(snapshot.rankings[group].map(row => row.bonusLamports), ['500', '300', '200']);
    assert.equal(BigInt(snapshot.rankings[group][0].scoreLamports) > BigInt(snapshot.rankings[group][1].scoreLamports), true);
  }
  assert.equal(snapshot.sources[0].payableLamports, '3000');
  assert.equal(snapshot.sources[0].retainedLamports, '0');
  const manifest = dailyBonusManifest(snapshot, snapshot.sources[0]);
  assert.equal(manifest.leaves.length, 9);
  for (const leaf of manifest.leaves) assert(verifyRewardProof({ ...leaf, ...manifest, recipient:leaf.recipient }));
});
test('snapshot is deterministic, deduplicates receipts, and rejects conflicting or incomplete evidence', () => {
  const input = bonusFixture(), expected = buildDailyBonusSnapshot(input);
  assert.equal(buildDailyBonusSnapshot({ ...input, collections:[...input.collections].reverse(),
    trades:[...input.trades].reverse().concat(input.trades[0]) }).hash, expected.hash);
  assert.throws(() => buildDailyBonusSnapshot({ ...input, coverage:[{ mint:wallets[9], complete:false }] }), /Complete finalized/);
  assert.throws(() => buildDailyBonusSnapshot({ ...input, trades:[...input.trades,
    { ...input.trades[0], amountLamports:'999' }] }), /Conflicting/);
  assert.throws(() => buildDailyBonusSnapshot({ ...input, trades:[{ ...input.trades[0], blockTime:input.now }] }), /UTC day/);
  assert.throws(() => buildDailyBonusSnapshot({ ...input, coverage:[] }), /outside complete coverage/);
});
test('unfilled rank shares stay in the reserve and the same wallet has one leaf across categories', () => {
  const input = bonusFixture();
  const snapshot = buildDailyBonusSnapshot({ ...input, collections:[input.collections[0]],
    trades:[{ ...input.trades[0], wallet:wallets[0] }] });
  const source = snapshot.sources[0], manifest = dailyBonusManifest(snapshot, source);
  assert.equal(source.payableLamports, '1500'); assert.equal(source.retainedLamports, '1500');
  assert.equal(manifest.leaves.length, 2);
  assert.equal(manifest.leaves.find(row => row.recipient === wallets[0]).amount, '1000');
});
test('only launches that recorded the daily bonus policy can fund awards; old community funds stay excluded', () => {
  const input = bonusFixture(), snapshot = buildDailyBonusSnapshot({ ...input,
    collections:input.collections.map(row => ({ ...row, dailyBonusVersion:null })) });
  assert.equal(snapshot.sources.length, 0);
  assert.equal(snapshot.rankings.creators.length, 3);
});

test('published and approved policies both allocate 4% gross with equal categories and category-relative rank awards',()=>{
  try {
    for(const split of [PROTOCOL_FEE_SPLIT,agencyProtocolSplit()]) {
      setActiveProtocolFeeSplit(split);
      assert.equal(FEE_DISTRIBUTION.communityEffectivePercent,4);
      const input=bonusFixture(), gross=300_000_000_000n;
      const snapshot=buildDailyBonusSnapshot({...input,collections:input.collections.map((row,index)=>({...row,
        communityLamports:index===0?String(gross*BigInt(FEE_DISTRIBUTION.communityEffectivePercent)/100n):'0'}))});
      for(const group of ['creators','referrals','traders']) {
        assert.deepEqual(snapshot.rankings[group].map(row=>row.bonusLamports),['2000000000','1200000000','800000000']);
      }
      assert.equal(snapshot.sources[0].payableLamports,'12000000000');
      assert.match(currentFeePolicyCopy().bonus,/4% Daily bonus pool/);
      assert.match(currentFeePolicyCopy().bonus,/each receive one third/);
      assert.match(currentFeePolicyCopy().bonus,/of the category budget/);
    }
  } finally {setActiveProtocolFeeSplit(PROTOCOL_FEE_SPLIT);}
});
