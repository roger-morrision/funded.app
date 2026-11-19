import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { recoverPaymentSignature } from '../server/automatic-reward-chain.mjs';
import { backfillPaymentSignatures } from '../server/reward-signature-backfill.mjs';

const sig = n => String(n).repeat(88).slice(0, 88).replace(/0/g, '1');
const payment = Keypair.generate().publicKey.toBase58();

test('recovered payout signature is the oldest successful finalized signature on the payment account', async () => {
  const connection = { getSignaturesForAddress: async () => [
    { signature: sig(3), err: null }, { signature: sig(2), err: { InstructionError: [0, 'x'] } }, { signature: sig(4), err: null }] };
  assert.equal(await recoverPaymentSignature(connection, payment), sig(4));
});

test('payout signature recovery gives null for truncated history or RPC failure', async () => {
  const full = { getSignaturesForAddress: async () => Array.from({ length: 50 }, (_, i) => ({ signature: sig(i % 9 + 1), err: null })) };
  assert.equal(await recoverPaymentSignature(full, payment), null);
  assert.equal(await recoverPaymentSignature({ getSignaturesForAddress: async () => { throw Error('down'); } }, payment), null);
});

test('paid leaves without a signature are backfilled once; others are left alone', async () => {
  const state = { schedules: { a: { id: 'a', payments: {
    w1: { status: 'paid', finalized: true, signature: null, payment },
    w2: { status: 'paid', finalized: true, signature: sig(5), payment },
    w3: { status: 'verification-pending', payment } } } } };
  const store = { transaction: async fn => fn(state) };
  let calls = 0;
  const chain = { paymentSignature: async () => { calls += 1; return sig(7); } };
  assert.equal(await backfillPaymentSignatures({ store, chain }), 1);
  assert.equal(state.schedules.a.payments.w1.signature, sig(7));
  assert.equal(state.schedules.a.payments.w1.signatureRecovered, true);
  assert.equal(state.schedules.a.payments.w2.signature, sig(5));
  assert.equal(state.schedules.a.payments.w3.signature, undefined);
  assert.equal(await backfillPaymentSignatures({ store, chain }), 0);
  assert.equal(calls, 1);
  assert.equal(await backfillPaymentSignatures({ store, chain: {} }), 0);
});
