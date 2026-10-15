import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoinSummary } from '../coin-summary-model.js';

const mint = 'qa-mint';
const launch = { mint, cluster:'devnet', onchainVerified:true,
  feeDistribution:{ creatorDirected:{ shares:{ holderAirdropPercent:80, solClaimPercent:0 } } } };
const plan = { status:'allocated-not-funded', mint, sourceCollectionSignature:'collected-a',
  grossLamports:'80000000', creatorDirected:{ holderLamports:'64000000', xLamports:'0' },
  protocol:{ buybackLamports:'4000000', communityLamports:'1600000' } };
const overview = { available:true, scope:'per-mint-v3', collections:[
  { signature:'collected-a', amountLamports:'80000000', settlement:'finalized', allocationPlan:plan },
  { signature:'collected-b', amountLamports:'20000000', settlement:'pending', allocationPlan:null },
] };
const input = { mint, cluster:'devnet', launch, ledgerMint:mint, overview,
  market:{ coverage:'unavailable' }, solUsd:100, tokenSpotSol:null };
const cards = value => Object.fromEntries(buildCoinSummary(value).cards.map(row => [row.id, row]));

test('V3 coin cards use verified collection and settlement fields without implying payout', () => {
  const result = cards(input);
  assert.equal(result.fees.amount, 10);
  assert.match(result.fees.note, /2 recorded fee collections/);
  assert.equal(result.holders.amount, 6.4);
  assert.equal(result.buyback.amount, 0.4);
  assert.equal(result.community.amount, 0.16);
  assert.match(result.holders.note, /check payment history/);
  assert.equal(result.referrals.amount, null);
  assert.equal(result.referrals.note, 'See Rewards for verified referral payouts');
});

test('V3 cards fail closed on inconsistent allocation evidence and distinguish missing prices', () => {
  const tampered = { ...input, overview:{ ...overview, collections:[
    { ...overview.collections[0], allocationPlan:{ ...plan, grossLamports:'70000000' } },
    overview.collections[1],
  ] } };
  const result = cards(tampered);
  assert.equal(result.fees.amount, 10);
  assert.equal(result.holders.amount, null);
  assert.equal(result.holders.note, 'Verified amount unavailable');
  assert.equal(cards({ ...input, solUsd:null }).fees.note, 'Current SOL price unavailable');
});
