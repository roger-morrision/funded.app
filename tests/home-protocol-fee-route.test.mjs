import test from 'node:test';
import assert from 'node:assert/strict';
import { homeFeeAllocationSummary } from '../server/home-dashboard-metrics.mjs';
import { protocolFeeRouteModel } from '../src/features/home/protocol-fee-route.js';

test('home protocol route reconciles verified V3 settlement categories and current future-launch policy', () => {
  const split = { operationsPercent:40, referralLevelPercents:[20, 5, 5],
    communityPercent:10, buybackPercent:20 };
  const collection = { signature:'sig-1', mint:'mint-1', cluster:'devnet', status:'collected',
    onchainVerified:true, scope:'per-mint-v3', collectedLamports:'1000000000' };
  const state = {
    adminSettings:{ protocolFeePolicy:{ split, revision:2, updatedAt:'2026-10-15T00:00:00Z' } },
    launches:{ 'mint-1':{ cluster:'devnet', onchainVerified:true, creator:'router-1',
      pumpFeeRoute:{ scope:'per-mint-v3', router:'router-1' } } },
    collections:{ valid:collection, unproved:{ ...collection, signature:'sig-2' } },
    v3Settlements:{
      'sig-1':{ signature:'sig-1', mint:'mint-1', status:'finalized', allocationPlan:{
        status:'allocated-not-funded', grossLamports:'1000000000',
        creatorDirected:{ holderLamports:'0', xLamports:'0' },
        protocol:{ operationsLamports:'80000000', referralLamports:['40000000', '10000000', '10000000'],
          communityLamports:'20000000', buybackLamports:'40000000' },
      } },
    },
  };
  const evidence = { cluster:'devnet', status:'partial', coverage:{ recordedCollections:2 },
    verifiedCollections:[{ signature:'sig-1', mint:'mint-1', collectedLamports:'1000000000' }] };
  const summary = homeFeeAllocationSummary(state, evidence, 'devnet');
  assert.equal(summary.status, 'partial');
  assert.equal(summary.settledCollections, 1);
  assert.deepEqual([summary.operationsLamports, summary.referralLamports,
    summary.communityLamports, summary.buybackLamports, summary.appRevenueLamports],
  ['80000000', '60000000', '20000000', '40000000', '200000000']);
  assert.deepEqual(summary.currentPolicy.split, split);
  const view = protocolFeeRouteModel(summary);
  assert.equal(view.state, 'partial');
  assert.deepEqual(view.rows.map(row => row.share),
    ['40% of app share', '30% of app share', '10% of app share', '20% of app share']);
  assert.deepEqual(view.rows.map(row => row.amount),
    ['0.08 SOL allocated', '0.06 SOL allocated', '0.02 SOL allocated', '0.04 SOL allocated']);
  assert.match(view.evidenceNote, /partial receipt coverage/);
});

test('home protocol route shows policy but hides amounts when evidence is missing or totals disagree', () => {
  const base = homeFeeAllocationSummary({}, { cluster:'devnet', status:'unavailable' }, 'devnet');
  const missing = protocolFeeRouteModel(base);
  assert.equal(missing.state, 'policy-only');
  assert.equal(missing.rows[0].amount, '—');
  const inconsistent = protocolFeeRouteModel({ ...base, status:'verified', settledCollections:1,
    operationsLamports:'1', appRevenueLamports:'0' });
  assert.equal(inconsistent.state, 'policy-only');
  assert.equal(inconsistent.rows[0].amount, '—');
  const invalidPolicy = protocolFeeRouteModel({ ...base, currentPolicy:{ split:{
    operationsPercent:100, referralLevelPercents:[10, 3, 2], communityPercent:10, buybackPercent:25 } } });
  assert.equal(invalidPolicy.state, 'unavailable');
});
