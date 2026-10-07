import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardPaidTotals } from '../server/reward-paid-totals.mjs';

const wallet = 'A'.repeat(32);
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const evidence = { cluster:'devnet', commitment:'finalized', status:'onchain-indexed', verifiedPayouts:[] };

test('counts every finalized holder payment, beyond the recent payment-history window', () => {
  const payments = Object.fromEntries([...alphabet.slice(0, 31)].map((letter, index) => [
    `${letter.repeat(31)}${index % 9 + 1}`, {
      status:'paid', amount:'1000', signature:letter.repeat(64), finalized:true, balanceDeltaVerified:true,
    },
  ]));
  // A schedule maps one payment per recipient. Use separate schedules for the
  // same wallet receiving rewards across 31 cycles.
  const schedules = Object.fromEntries(Object.entries(payments).map(([id, payment]) => [id, {
    kind:'holder', asset:'SOL', payments:{ [wallet]:payment },
  }]));
  const totals = rewardPaidTotals({}, { schedules }, evidence, 'devnet');
  assert.deepEqual(totals.holder, { paidLamports:'31000', payoutCount:31, status:'verified' });
  assert.deepEqual(totals.x, { paidLamports:'0', payoutCount:0, status:'verified' });
});

test('includes only matched finalized X claims and marks missing proofs as partial', () => {
  const signature = 'B'.repeat(64), missing = 'C'.repeat(64);
  const automaticSignature = 'D'.repeat(64);
  const state = { payouts: {
    verified:{ source:'mint-router-settle-mint', status:'paid', cluster:'devnet', signature,
      to:wallet, amountLamports:118812 },
    pendingProof:{ source:'mint-router-settle-mint', status:'paid', cluster:'devnet', signature:missing,
      to:wallet, amountLamports:500 },
  } };
  const rewards = { schedules: {
    x:{ kind:'x', asset:'SOL', payments:{ [wallet]:{ status:'paid', amount:'187844', signature:automaticSignature,
      finalized:true, balanceDeltaVerified:true } } },
    notFinalized:{ kind:'holder', asset:'SOL', payments:{ [wallet]:{ status:'paid', amount:'500', signature:'E'.repeat(64),
      finalized:false, balanceDeltaVerified:true } } },
  } };
  const proofs = { ...evidence, verifiedPayouts:[{ source:'mint-router-settle-mint', signature,
    to:wallet, amountLamports:118812, actualReceivedLamports:118812 }] };
  const totals = rewardPaidTotals(state, rewards, proofs, 'devnet');
  assert.deepEqual(totals.holder, { paidLamports:'0', payoutCount:0, status:'partial' });
  assert.deepEqual(totals.x, { paidLamports:'306656', payoutCount:2, status:'partial' });
});

test('withholds both totals when the reward ledger is unavailable', () => {
  const totals = rewardPaidTotals({}, null, evidence, 'devnet');
  assert.deepEqual(totals.holder, { paidLamports:null, payoutCount:null, status:'unavailable' });
  assert.deepEqual(totals.x, { paidLamports:null, payoutCount:null, status:'unavailable' });
});
