import test from 'node:test';
import assert from 'node:assert/strict';
import { feePayoutStats } from '../server/fee-payout-stats.mjs';

const mint = 'M'.repeat(32), creator = 'C'.repeat(32), holder = 'H'.repeat(32);
const xWallet = 'X'.repeat(32), source = 'S'.repeat(64);
const signature = letter => letter.repeat(64);
const payment = (amount, letter) => ({ status:'paid', amount:String(amount), signature:signature(letter),
  finalized:true, balanceDeltaVerified:true });
const state = {
  launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true, feeDistribution:{ creatorDirected:{
    recipients:{ xAccount:'@fundedvip' } } } } },
  collections:{ [source]:{ signature:source, mint, cluster:'devnet', status:'collected',
    onchainVerified:true, attribution:'mint-verified', collectedLamports:3000 } },
  settlements:{ [source]:{ claimSignature:source, asset:'SOL', grossCreatorFees:'0.000003', creatorDestinations:{
    creatorWallet:'0.000001', holderAirdrop:'0.000001', solClaim:'0.000001' } } },
  obligations:{ x1:{ id:'x1', mint, xUserId:'123' } },
};
const evidence = { cluster:'devnet', commitment:'finalized', status:'onchain-indexed',
  verifiedCollections:[{ signature:source, mint, collectedLamports:3000 }], verifiedPayouts:[] };
const request = (kind, id) => ({ mint, asset:'SOL', kind, status:'funded', balanceDeltaVerified:true,
  fundingSignature:signature('F'), sourceSignature:source, amount:'1000', ...(kind === 'x' ? { obligationId:'x1' } : {}) });

test('ranks only finalized fee-funded recipient payments and groups X by account', () => {
  const rewards = { fundingRequests:{ creator:request('creator'), holder:request('holder'), x:request('x') },
    rewardPools:{ holder:{ mint, asset:'SOL', balanceDeltaVerified:true,
      fundingSignature:signature('F'), amount:'1000' } },
    schedules:{
      creator:{ mint, kind:'creator', asset:'SOL', sourceId:'creator', fundingSignature:signature('F'),
        balanceDeltaVerified:true, manifest:{ leaves:[{ recipient:creator, amount:'500' }] },
        payments:{ [creator]:payment(500, 'A') } },
      holder:{ mint, kind:'holder', asset:'SOL', poolIds:['holder'],
        manifest:{ leaves:[{ recipient:holder, amount:'300' }] },
        payments:{ [holder]:payment(300, 'B') } },
      x:{ mint, kind:'x', asset:'SOL', sourceId:'x', fundingSignature:signature('F'),
        balanceDeltaVerified:true, manifest:{ leaves:[{ recipient:xWallet, amount:'200' }] },
        payments:{ [xWallet]:payment(200, 'D') } },
      duplicate:{ mint, kind:'x', asset:'SOL', sourceId:'x', fundingSignature:signature('F'),
        balanceDeltaVerified:true, manifest:{ leaves:[{ recipient:xWallet, amount:'200' }] },
        payments:{ [xWallet]:payment(200, 'D') } },
    } };
  const totals = feePayoutStats(state, rewards, evidence);
  assert.equal(totals.creator.paidLamports, '500');
  assert.equal(totals.holder.paidLamports, '300');
  assert.equal(totals.x.paidLamports, '200');
  assert.equal(totals.x.payoutCount, 1);
  assert.deepEqual(totals.x.top, { recipient:'123', handle:'@fundedvip', paidLamports:'200', payoutCount:1 });
  assert.equal(totals.fundedHolder.status, 'unavailable');
});

test('excludes payments without a matching finalized collection and signals partial coverage', () => {
  const rewards = { fundingRequests:{ creator:request('creator') }, schedules:{ creator:{
    mint, kind:'creator', asset:'SOL', sourceId:'creator', fundingSignature:signature('F'),
    balanceDeltaVerified:true, manifest:{ leaves:[{ recipient:creator, amount:'500' }] },
    payments:{ [creator]:payment(500, 'A') },
  } } };
  const missingProof = { ...evidence, verifiedCollections:[] };
  const totals = feePayoutStats(state, rewards, missingProof);
  assert.equal(totals.creator.paidLamports, '0');
  assert.equal(totals.creator.status, 'partial');
  assert.equal(totals.creator.top, null);
  assert.equal(feePayoutStats(state, null, evidence).creator.status, 'unavailable');
});

test('counts a direct X claim only when its wallet and amount match finalized proof', () => {
  const payout = { source:'mint-router-settle-mint', status:'paid', cluster:'devnet',
    mint, obligationId:'x1', claimId:'claim1', to:xWallet, signature:signature('P'), amountLamports:1000 };
  const claims = { claim1:{ obligationId:'x1', xUserId:'123', publicKey:xWallet } };
  const proof = { signature:signature('P'), to:xWallet, source:'mint-router-settle-mint',
    amountLamports:1000, actualReceivedLamports:1000 };
  const inputs = { ...state, obligations:{ x1:{ id:'x1', mint, xUserId:'123',
    claimSignature:source, amountLamports:'1000' } }, claims, payouts:{ p1:payout } };
  const matched = feePayoutStats(inputs, { schedules:{} }, { ...evidence, verifiedPayouts:[proof] });
  assert.equal(matched.x.paidLamports, '1000');
  assert.equal(matched.x.top.handle, '@fundedvip');
  const mismatched = feePayoutStats(inputs, { schedules:{} }, {
    ...evidence, verifiedPayouts:[{ ...proof, actualReceivedLamports:0 }],
  });
  assert.equal(mismatched.x.paidLamports, '0');
  assert.equal(mismatched.x.status, 'partial');
});
