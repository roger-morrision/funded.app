import assert from 'node:assert/strict';
import { buildCoinSummary } from '../coin-summary-model.js';

const mint = 'mint-a';
const launch = {
  mint, cluster:'devnet', onchainVerified:true,
  feeDistribution:{ creatorDirected:{ shares:{ holderAirdropPercent:20, solClaimPercent:10 } } },
  communityAirdrop:{ reservedTokens:30_000_000 },
  creatorLaunchBurn:{ status:'verified', amountTokens:25_000, receipt:{ signature:'burn-a', verified:true } },
};
const row = (id, allocatedLamports, confirmedPaidLamports = '0', payoutSignatures = []) => ({
  id, allocatedLamports, confirmedPaidLamports, payoutSignatures,
});
const overview = {
  available:true, collectedLamports:'1000000000', collectionCount:2,
  receivers:[
    row('holders','200000000'), row('x','100000000'), row('buyback','10000000'),
    row('community','30000000'), row('referral-1','20000000','5000000',['ref-pay-a']),
    row('referral-2','0','0',['zero-value-receipt']), row('referral-3','0'),
  ],
};
const input = {
  mint, cluster:'devnet', launch, ledgerMint:mint, overview,
  market:{ coverage:'partial', volume24hSol:0.5, graduated:false }, solUsd:100, tokenSpotSol:0.000001,
};
const summary = buildCoinSummary(input);
const cards = Object.fromEntries(summary.cards.map(card => [card.id, card]));
assert.equal(summary.visible, true);
assert.equal(cards.fees.amount, 100);
assert.equal(cards.holders.amount, 20);
assert.equal(cards.x.amount, 10);
assert.equal(cards.buyback.amount, 1);
assert.equal(cards.community.amount, 3);
assert.equal(cards.referrals.amount, 0.5);
assert.match(cards.referrals.note, /^1 verified payout receipt /);
assert.equal(cards.airdrop.amount, 3_000);
assert.equal(cards.airdrop.state, 'partial');
assert.equal(cards.burn.amount, 25_000);
assert.equal(cards.volume.amount, 50);
assert.equal(cards.volume.state, 'partial');

assert.deepEqual(buildCoinSummary({ ...input, launch:{ ...launch, onchainVerified:false } }), { visible:false, cards:[] });
const wrongLedger = buildCoinSummary({ ...input, ledgerMint:'different-mint' });
assert.equal(wrongLedger.cards.find(card => card.id === 'fees').amount, null);
assert.equal(wrongLedger.cards.find(card => card.id === 'referrals').amount, null);
assert.equal(buildCoinSummary({ ...input, solUsd:null }).cards.find(card => card.id === 'fees').amount, null);
assert.equal(buildCoinSummary({ ...input, market:{ coverage:'unavailable', volume24hSol:null } }).cards.find(card => card.id === 'volume').amount, null);
const noOptionalRewards = buildCoinSummary({ ...input, launch:{ ...launch, feeDistribution:{ creatorDirected:{ shares:{ holderAirdropPercent:0, solClaimPercent:0 } } }, creatorLaunchBurn:null }, overview:{ ...overview, receivers:overview.receivers.filter(row => !['holders','x'].includes(row.id)) } });
assert.equal(noOptionalRewards.cards.some(card => ['holders','x','burn'].includes(card.id)), false);

console.log('coin summary: per-mint accounting, USD conversion, and unavailable states passed');
