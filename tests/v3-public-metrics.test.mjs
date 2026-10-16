import test from 'node:test';
import assert from 'node:assert/strict';
import { v3PublicMetrics, v3ReceiptEvidence } from '../server/v3-public-metrics.mjs';

test('public analytics exclude V2 collections and payouts while retaining verified V3 receipts', () => {
  const source='3'.repeat(64), old='4'.repeat(64), mint='5'.repeat(44);
  const state={ collections:{ [source]:{signature:source,mint,cluster:'devnet',
    scope:'per-mint-v3',status:'collected',onchainVerified:true,collectedLamports:100},
    [old]:{signature:old,mint,cluster:'devnet',scope:'per-mint-v2',status:'collected',
      onchainVerified:true,collectedLamports:999} },
    v3Settlements:{ [source]:{status:'finalized',allocationPlan:{status:'allocated-not-funded',
      protocol:{buybackLamports:'10'}}} } };
  const evidence={cluster:'devnet',commitment:'finalized',status:'onchain-indexed',
    verifiedCollections:[{signature:source,mint,collectedLamports:100},
      {signature:old,mint,collectedLamports:999}]};
  const filtered=v3ReceiptEvidence(state,evidence,'devnet');
  assert.deepEqual(filtered.verifiedCollections.map(row=>row.signature),[source]);
  assert.deepEqual(filtered.verifiedPayouts,[]);
  const history={cluster:'devnet',commitment:'finalized',status:'onchain-indexed',
    verifiedPayouts:[{source:'automatic-x',to:mint,signature:source,amountLamports:5,
      xHandle:'@fixture'}]};
  const metrics=v3PublicMetrics(state,evidence,history,{},'devnet');
  assert.equal(metrics.collectedLamports,100);
  assert.equal(metrics.recordedCollections,1);
  assert.equal(metrics.rewardPaid.x.paidLamports,'5');
  assert.equal(metrics.feePayoutStats.x.top.handle,'@fixture');
  assert.equal(metrics.feePayoutStats.creator.status,'verified');
  assert.equal(metrics.feePayoutStats.creator.payoutCount,0);
});

test('V3 metrics expose verified creator payments and fresh community claim counts', () => {
  const wallet='5'.repeat(44), mint='6'.repeat(44), signature='3'.repeat(64);
  const history={cluster:'devnet',commitment:'finalized',status:'onchain-indexed',
    generatedAt:new Date().toISOString(), checkedAutomatic:0, checkedCreator:1,
    verifiedPayouts:[{source:'v3-creator-wallet',signature,to:wallet,amountLamports:60}]};
  const rewards={communityClaimIndex:{cluster:'devnet',commitment:'finalized',status:'verified',
    indexedAt:new Date().toISOString(), drops:[{mint,claimCount:1,claimedBaseUnits:'9'}],
    payments:[{mint,recipient:wallet,amountBaseUnits:'9',payment:'7'.repeat(44)}]}};
  const summary=v3PublicMetrics({}, {cluster:'devnet',commitment:'finalized',status:'no-records'},
    history,rewards,'devnet');
  assert.equal(summary.feePayoutStats.creator.paidLamports,'60');
  assert.equal(summary.feePayoutStats.fundedHolder.claimCount,1);
  assert.equal(summary.recordedPayouts,1);
  assert.equal(summary.verifiedPayoutCount,1);
  rewards.communityClaimIndex.indexedAt='2020-01-01T00:00:00.000Z';
  assert.equal(v3PublicMetrics({}, {}, history,rewards,'devnet').feePayoutStats.fundedHolder.status,'unavailable');
});
