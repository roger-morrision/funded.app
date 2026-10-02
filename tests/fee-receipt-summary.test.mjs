import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { analyticsReceiptTotals } from '../server/analytics-summary.mjs';
import { rewardLedgerPath } from '../server/reward-ledger-path.mjs';

test('API, scheduler and status resolve the same reward ledger profile', () => {
  const cwd = 'C:\\funded';
  assert.equal(rewardLedgerPath({ FUNDED_STORE_PATH:'fixtures/main.json' }, cwd),
    `${resolve(cwd, 'fixtures/main.json')}.automatic-rewards.json`);
  assert.match(rewardLedgerPath({ FUNDED_STORE_PATH:'fixtures/main.json' }, cwd), /main\.json\.automatic-rewards\.json$/);
  assert.match(rewardLedgerPath({}, cwd), /data[\\/]automatic-rewards\.json$/);
  assert.match(rewardLedgerPath({ FUNDED_STORE_PATH:'fixtures/main.json', AUTOMATIC_REWARD_STORE_PATH:'fixtures/rewards.json' }, cwd), /fixtures[\\/]rewards\.json$/);
});

test('analytics excludes unproved and other-cluster ledger amounts', () => {
  const launch = { onchainVerified:true, cluster:'devnet' };
  const state = {
    lastIndexedAt:'2026-10-01T00:00:00Z',
    launches:{ mintA:launch, mintB:launch, mintC:{ ...launch, cluster:'mainnet-beta' } },
    collections:{
      a:{ cluster:'devnet', mint:'mintA', signature:'sig-a', status:'collected', attribution:'mint-verified', onchainVerified:true, collectedLamports:1_000_000_000 },
      b:{ cluster:'devnet', mint:'mintB', signature:'sig-b', status:'collected', attribution:'mint-verified', onchainVerified:true, collectedLamports:2_000_000_000 },
      c:{ cluster:'mainnet-beta', mint:'mintC', signature:'sig-c', status:'collected', attribution:'mint-verified', onchainVerified:true, collectedLamports:9_000_000_000 },
    },
    settlements:{
      'sig-a':{ claimSignature:'sig-a', asset:'SOL', grossCreatorFees:1, fundedApp:{ buyback:0.01 } },
      'sig-b':{ claimSignature:'sig-b', asset:'SOL', grossCreatorFees:2, fundedApp:{ buyback:0.02 } },
      'sig-c':{ claimSignature:'sig-c', asset:'SOL', grossCreatorFees:9, fundedApp:{ buyback:0.09 } },
    },
  };
  const evidence = { cluster:'devnet', commitment:'finalized', scope:'global-recent', status:'partial',
    verifiedCollections:[{ signature:'sig-a', mint:'mintA', collectedLamports:1_000_000_000 }],
    verifiedPayouts:[{ signature:'paid-a', amountLamports:100_000_000 }] };
  const totals = analyticsReceiptTotals(state, evidence, 'devnet');
  assert.equal(totals.status, 'partial');
  assert.equal(totals.recordedCollectedLamports, 3_000_000_000);
  assert.equal(totals.collectedLamports, 1_000_000_000);
  assert.equal(totals.grossCreatorFees, 1);
  assert.equal(totals.buybackAccrued, 0.01);
  assert.equal(totals.finalizedPaidLamports, 100_000_000);
  assert.equal(totals.verifiedPayoutCount, 1);
  assert.equal(analyticsReceiptTotals(state, { ...evidence, commitment:'confirmed' }, 'devnet').collectedLamports, 0);
  assert.equal(analyticsReceiptTotals(state, { ...evidence, status:'unavailable' }, 'devnet').status, 'unavailable');
  assert.equal(analyticsReceiptTotals(state, { ...evidence, status:'unverified-records' }, 'devnet').status, 'recorded-claims-only');
  const mismatched = structuredClone(state);
  mismatched.settlements['sig-a'].grossCreatorFees = 2;
  assert.equal(analyticsReceiptTotals(mismatched, evidence, 'devnet').grossCreatorFees, 0);
});
