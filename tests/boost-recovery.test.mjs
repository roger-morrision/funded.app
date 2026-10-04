import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBoostQuote, boostPaymentResolution, readPendingBoost, archiveBoostPayment, saveSignedBoostPayment } from '../boost-checkout-recovery.js';
const mint = '1'.repeat(32), signature = '1'.repeat(88);
const quote = { id: 'boost_123_0123456789abcdef', mint, payer: mint, recipient: mint, packageId: '10x', cluster: 'devnet', lamports: 990000000, usd: 99, solUsd: 100, expiresAt: '2030-01-01T00:00:00Z', memo: 'funded.vip:boost:devnet:boost_123_0123456789abcdef' };
const pending = { pendingSignature: signature, quote };
const proof = { status: 'failed', signature, quoteId: quote.id, cluster: 'devnet', commitment: 'finalized', slot: 100 };
function memory() {
  const rows = new Map([[`funded.boost.pending.${mint}`, JSON.stringify({ signature, quote })]]);
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
}
test('only matching finalized failure releases a signed payment; missing or expired stays pending', () => {
  for (const fields of [{ signature: '2'.repeat(88) }, { quoteId: 'wrong' }, { cluster: 'mainnet-beta' }, { commitment: 'confirmed' }, { slot: 0 }]) {
    assert.throws(() => boostPaymentResolution({ ...proof, ...fields }, pending));
  }
  assert.equal(boostPaymentResolution({ status: 'pending', blockhashExpired: true }, pending), 'pending');
  assert.equal(boostPaymentResolution(proof, pending), 'failed');
  const storage = memory();
  archiveBoostPayment(pending, proof, storage);
  assert.equal(readPendingBoost(mint, storage), null);
  assert.equal(JSON.parse(storage.getItem(`funded.boost.resolved.${mint}`)).proof.slot, 100);
});
test('recovery cannot erase another tab payment or silently clear unreadable recovery', () => {
  const storage = memory();
  storage.setItem(`funded.boost.pending.${mint}`, JSON.stringify({ signature: '2'.repeat(88), quote }));
  assert.throws(() => archiveBoostPayment(pending, proof, storage), /Another payment/);
  assert.equal(readPendingBoost(mint, storage).signature, '2'.repeat(88));
  storage.setItem(`funded.boost.pending.${mint}`, '{');
  assert.throws(() => readPendingBoost(mint, storage), /unreadable/);
});
test('a failed archive write preserves the original pending payment', () => {
  const storage = memory();
  storage.setItem = () => { throw new Error('full'); };
  assert.throws(() => archiveBoostPayment(pending, proof, storage));
  assert.equal(readPendingBoost(mint, storage).signature, signature);
});
test('quotes require matching identity, network, price, safe units, future expiry and exact memo', () => {
  assert.equal(validateBoostQuote(quote, quote), quote);
  for (const field of [{ cluster: 'mainnet-beta' }, { lamports: Number.MAX_SAFE_INTEGER + 1 }, { expiresAt: 'not-a-date' }, { expiresAt: '2020-01-01' }, { usd: 100 }, { memo: 'different' }, { mint: 'different' }]) {
    assert.throws(() => validateBoostQuote({ ...quote, ...field }, quote));
  }
});

test('checkout exposes an explicit new-quote action only after finalized failure and preserves unknown payments', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('async function handleExploreBoostPay(){'), source.indexOf('function verifiedLaunchPolicyForMint('));
  const storage = memory();
  const checkout = { mint, quote, pendingSignature: signature, busy: false };
  const context = {
    boostCheckout: checkout, boostPaymentResolution,
    archiveBoostPayment: (item, evidence) => archiveBoostPayment(item, evidence, storage),
    renderExploreBoostDialog() {}, apiRequest: async () => ({ available: true, data: proof }),
    setTimeout: callback => callback(),
  };
  vm.runInNewContext(functions, context);
  await context.verifyExploreBoostPayment();
  assert.equal(checkout.failureProof, proof);
  assert.equal(checkout.pendingSignature, signature, 'Failure receipt alone does not clear the signed intent');
  await context.handleExploreBoostPay();
  assert.equal(checkout.pendingSignature, null);
  assert.equal(checkout.quote, null);
  assert.equal(readPendingBoost(mint, storage), null);
  checkout.pendingSignature = signature;
  checkout.quote = quote;
  context.apiRequest = async () => ({ available: true, data: { status: 'pending', blockhashExpired: true } });
  await context.verifyExploreBoostPayment();
  assert.equal(checkout.pendingSignature, signature);
  assert.equal(checkout.failureProof, null);
  assert.match(checkout.message, /unconfirmed/);
});

test('another checkout cannot overwrite an unresolved signed payment', async () => {
  const storage = memory();
  let locked = false;
  const locks = { request: async (key, callback) => { locked = key.endsWith(mint); return callback(); } };
  await assert.rejects(saveSignedBoostPayment({ quote, signature: '2'.repeat(88) }, storage, locks), /already saved/);
  assert.equal(locked, true);
  assert.equal(readPendingBoost(mint, storage).signature, signature);
});
