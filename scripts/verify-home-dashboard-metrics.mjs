import assert from 'node:assert/strict';
import { homeFeeAllocationSummary } from '../server/home-dashboard-metrics.mjs';

const mint = 'verified-mint';
const collection = {
  signature:'verified-claim', mint, cluster:'devnet', status:'collected',
  scope:'per-mint-v3', onchainVerified:true, collectedLamports:1_000_000_000,
};
const state = {
  launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true, creator:'router',
    pumpFeeRoute:{ scope:'per-mint-v3', router:'router' },
    creatorLaunchBurn:{ status:'verified', receipt:{ signature:'burn-one', amountTokens:10 } } } },
  collections:{ 'verified-claim':collection, 'unverified-claim':{ ...collection, signature:'unverified-claim' } },
  v3Settlements:{
    'verified-claim':{ status:'finalized', mint, allocationPlan:{
      status:'allocated-not-funded', grossLamports:'1000000000',
      creatorDirected:{ holderLamports:'200000000', xLamports:'100000000' },
      protocol:{ operationsLamports:'160000000', referralLamports:['0','0','0'],
        buybackLamports:'10000000', communityLamports:'30000000' } } },
    'unverified-claim':{ status:'finalized', mint, allocationPlan:{
      status:'allocated-not-funded', grossLamports:'1000000000',
      creatorDirected:{ holderLamports:'500000000', xLamports:'500000000' },
      protocol:{ operationsLamports:'0', referralLamports:[],
        buybackLamports:'0', communityLamports:'0' } } },
  },
  burnReceipts:{
    one:{ signature:'burn-one', cluster:'devnet', status:'verified', onchainVerified:true, amountTokens:10 },
    two:{ signature:'burn-two', cluster:'devnet', status:'verified', onchainVerified:true, amountTokens:2 },
    pending:{ signature:'burn-pending', cluster:'devnet', status:'pending', amountTokens:100 },
  },
};
const evidence = { cluster:'devnet', status:'partial',
  coverage:{ recordedCollections:2 },
  verifiedCollections:[{ signature:'verified-claim', mint, collectedLamports:1_000_000_000 }] };
const summary = homeFeeAllocationSummary(state, evidence, 'devnet');
assert.equal(summary.status, 'partial');
assert.equal(summary.settledCollections, 1);
assert.equal(summary.appRevenueLamports, '200000000');
assert.equal(summary.holderLamports, '200000000');
assert.equal(summary.xLamports, '100000000');
assert.equal(summary.buybackLamports, '10000000');
assert.equal(summary.communityLamports, '30000000');
assert.equal(summary.verifiedBurnCount, 2);
assert.equal(summary.burnedTokens, 12);

const unavailable = homeFeeAllocationSummary(state, { ...evidence, status:'unavailable' }, 'devnet');
assert.equal(unavailable.status, 'unavailable');
assert.equal(unavailable.appRevenueLamports, '0');
assert.equal(unavailable.holderLamports, '0');
assert.equal(unavailable.verifiedBurnCount, 2);
const empty = homeFeeAllocationSummary({ launches:{}, collections:{}, settlements:{} },
  { cluster:'devnet', status:'no-records', coverage:{ recordedCollections:0 }, verifiedCollections:[] }, 'devnet');
assert.equal(empty.status, 'verified');
assert.equal(empty.xLamports, '0');
console.log('home dashboard allocation checks passed');
