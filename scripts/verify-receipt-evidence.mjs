import assert from 'node:assert/strict';
import { verifyCollectionReceipt, verifyPayoutReceipt } from '../server/receipt-evidence.mjs';

const signature = '3'.repeat(88);
const router = '2'.repeat(44);
const recipient = '4'.repeat(44);
const mint = '5'.repeat(44);
const transaction = {
  slot: 123,
  blockTime: 1_700_000_000,
  transaction: { signatures: [signature], message: { accountKeys: [router, recipient] } },
  meta: { err: null, preBalances: [1_000_000, 10_000], postBalances: [900_000, 110_000] },
};
const collection = { cluster: 'devnet', signature, status: 'collected', attribution: 'mint-verified', onchainVerified: true,
  mint, router: recipient, collectedLamports: 100_000 };
const payout = { cluster: 'devnet', signature, status: 'paid', source: 'mint-router-settle-mint',
  from: router, to: recipient, amountLamports: 100_000 };

assert.equal(verifyCollectionReceipt(collection, transaction)?.collectedLamports, 100_000);
assert.equal(verifyPayoutReceipt(payout, transaction)?.amountLamports, 100_000);
assert.equal(verifyCollectionReceipt({ ...collection, cluster: 'mainnet-beta' }, transaction), null);
assert.equal(verifyCollectionReceipt({ ...collection, attribution: 'router' }, transaction), null);
assert.equal(verifyCollectionReceipt({ ...collection, onchainVerified: false }, transaction), null);
assert.equal(verifyCollectionReceipt({ ...collection, collectedLamports: 99_999 }, transaction), null);
assert.equal(verifyCollectionReceipt(collection, { ...transaction, meta: { ...transaction.meta, err: { InstructionError: [0, 'Custom'] } } }), null);
assert.equal(verifyCollectionReceipt(collection, { ...transaction, transaction: { ...transaction.transaction, signatures: ['6'.repeat(88)] } }), null);
assert.equal(verifyPayoutReceipt({ ...payout, amountLamports: 99_999 }, transaction), null);
assert.equal(verifyPayoutReceipt({ ...payout, status: 'submitted' }, transaction), null);
assert.equal(verifyPayoutReceipt({ ...payout, source: 'untrusted' }, transaction), null);
assert.equal(verifyPayoutReceipt(payout, null), null);
assert.equal(verifyPayoutReceipt(payout, { ...transaction, meta: { ...transaction.meta, postBalances: [900_000, 109_999] } }), null);
console.log('receipt evidence checks passed');
