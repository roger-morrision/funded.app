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
  assert.equal(totals.precisionStatus, 'safe');
  assert.deepEqual(totals.precisionUnavailableFields, []);
  assert.deepEqual(totals.exactLamports, { recordedCollectedLamports:'3000000000', collectedLamports:'1000000000', finalizedPaidLamports:'100000000' });
  assert.equal(analyticsReceiptTotals(state, { ...evidence, commitment:'confirmed' }, 'devnet').collectedLamports, 0);
  assert.equal(analyticsReceiptTotals(state, { ...evidence, status:'unavailable' }, 'devnet').status, 'unavailable');
  assert.equal(analyticsReceiptTotals(state, { ...evidence, status:'unverified-records' }, 'devnet').status, 'recorded-claims-only');
  const mismatched = structuredClone(state);
  mismatched.settlements['sig-a'].grossCreatorFees = 2;
  assert.equal(analyticsReceiptTotals(mismatched, evidence, 'devnet').grossCreatorFees, 0);
});

test('aggregate receipt base units stay exact at and beyond the safe numeric boundary', () => {
  const state = { launches:{ mint:{ onchainVerified:true, cluster:'devnet' } }, collections:{} };
  const evidence = { cluster:'devnet', commitment:'finalized', status:'onchain-indexed', verifiedCollections:[], verifiedPayouts:[] };
  for (const [signature, value] of [['first', Number.MAX_SAFE_INTEGER - 2], ['second', 2]]) {
    state.collections[signature] = { mint:'mint', signature, cluster:'devnet', status:'collected', attribution:'mint-verified', onchainVerified:true, collectedLamports:value };
    evidence.verifiedCollections.push({ mint:'mint', signature, collectedLamports:value });
    evidence.verifiedPayouts.push({ signature, amountLamports:value });
  }
  const safe = analyticsReceiptTotals(state, evidence, 'devnet');
  for (const field of ['recordedCollectedLamports', 'collectedLamports', 'finalizedPaidLamports']) {
    assert.equal(safe[field], Number.MAX_SAFE_INTEGER);
    assert.equal(safe.exactLamports[field], '9007199254740991');
  }
  assert.equal(safe.precisionStatus, 'safe');
  state.collections.first.collectedLamports = Number.MAX_SAFE_INTEGER;
  evidence.verifiedCollections[0].collectedLamports = Number.MAX_SAFE_INTEGER;
  evidence.verifiedPayouts[0].amountLamports = Number.MAX_SAFE_INTEGER;
  const before = structuredClone({ state, evidence });
  const overflow = analyticsReceiptTotals(state, evidence, 'devnet');
  for (const field of ['recordedCollectedLamports', 'collectedLamports', 'finalizedPaidLamports']) {
    assert.equal(overflow[field], null);
    assert.equal(overflow.exactLamports[field], '9007199254740993');
  }
  assert.equal(overflow.precisionStatus, 'overflow');
  assert.deepEqual(overflow.precisionUnavailableFields, ['recordedCollectedLamports', 'collectedLamports', 'finalizedPaidLamports']);
  assert.equal(overflow.verifiedPayoutCount, 2);
  assert.deepEqual({ state, evidence }, before);
  const roundTrip = JSON.parse(JSON.stringify(overflow));
  assert.equal(roundTrip.finalizedPaidLamports, null);
  assert.equal(roundTrip.exactLamports.finalizedPaidLamports, '9007199254740993');
  const unavailable = analyticsReceiptTotals(state, { ...evidence, status:'unavailable' }, 'devnet');
  assert.equal(unavailable.finalizedPaidLamports, 0);
  assert.equal(unavailable.exactLamports.finalizedPaidLamports, '0');
  assert.deepEqual(unavailable.precisionUnavailableFields, ['recordedCollectedLamports']);
});

test('exact analytics totals reject lossy or coerced base-unit inputs', () => {
  for (const value of [true, false, '9007199254740990.9', '15.000000000000001', '1e3', '0x10', ' 15', '015', 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    const state = { collections:{ invalid:{ cluster:'devnet', status:'collected', attribution:'mint-verified', onchainVerified:true, collectedLamports:value } } };
    const result = analyticsReceiptTotals(state, { cluster:'devnet', commitment:'finalized', status:'partial', verifiedPayouts:[{ amountLamports:value }] }, 'devnet');
    assert.equal(result.recordedCollections, 0, String(value));
    assert.equal(result.recordedCollectedLamports, 0, String(value));
    assert.equal(result.exactLamports.recordedCollectedLamports, '0', String(value));
    assert.equal(result.finalizedPaidLamports, 0, String(value));
    assert.equal(result.exactLamports.finalizedPaidLamports, '0', String(value));
  }
  const result = analyticsReceiptTotals({}, { cluster:'devnet', commitment:'finalized', status:'partial', verifiedPayouts:[{ amountLamports:'15' }, { amountLamports:15 }] }, 'devnet');
  assert.equal(result.finalizedPaidLamports, 30);
  assert.equal(result.exactLamports.finalizedPaidLamports, '30');
});
