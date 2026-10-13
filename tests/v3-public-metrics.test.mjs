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
  assert.equal(metrics.feePayoutStats.creator.status,'unavailable');
});
