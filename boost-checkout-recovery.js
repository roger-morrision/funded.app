import { boostMemo, boostPackage } from './boost-offer.js';
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const quotePattern = /^boost_\d+_[0-9a-f]{16}$/;

export function validateBoostQuote(quote, { mint, payer, packageId }, now = Date.now()) {
  const selected = boostPackage(packageId);
  if (!selected || !quote || quote.cluster !== 'devnet' || quote.mint !== mint || quote.payer !== payer || quote.packageId !== packageId
    || !quotePattern.test(quote.id) || !addressPattern.test(quote.recipient)
    || !Number.isSafeInteger(quote.lamports) || quote.lamports <= 0
    || !Number.isFinite(quote.solUsd) || quote.solUsd <= 0 || !Number.isFinite(quote.usd) || quote.usd <= 0
    || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= now
    || quote.usd !== selected.usd || quote.memo !== boostMemo(quote.id)) {
    throw new Error('The payment quote could not be verified. Request a fresh quote before signing.');
  }
  return quote;
}

export function boostPaymentResolution(data, pending) {
  if (!['finalized', 'failed'].includes(data?.status)) return 'pending';
  if (data.signature !== pending.pendingSignature || data.quoteId !== pending.quote?.id || data.cluster !== 'devnet'
    || !Number.isSafeInteger(data.slot) || data.slot < 1 || (data.status === 'failed' && data.commitment !== 'finalized')) {
    throw new Error('The payment receipt does not match this signed payment. Check the original transaction again.');
  }
  return data.status;
}

export function readPendingBoost(mint, storage = globalThis.localStorage) {
  const raw = storage.getItem(`funded.boost.pending.${mint}`);
  if (raw == null) return null;
  let pending;
  try { pending = JSON.parse(raw); } catch { throw new Error('Saved payment details are unreadable. Keep this device data and contact support before paying again.'); }
  if (!signaturePattern.test(pending?.signature) || pending?.quote?.mint !== mint || !quotePattern.test(pending?.quote?.id)
    || pending.quote.cluster !== 'devnet') throw new Error('Saved payment details could not be verified. Contact support before paying again.');
  return pending;
}

// Only a matching finalized receipt can release the single pending payment.
// Missing history and an expired blockhash never prove that a payment failed.
export function archiveBoostPayment(pending, proof, storage = globalThis.localStorage) {
  const resolution = boostPaymentResolution(proof, pending);
  if (resolution === 'pending') throw new Error('Payment is still being checked.');
  const mint = pending.quote.mint;
  const stored = readPendingBoost(mint, storage);
  if (stored && (stored.signature !== pending.pendingSignature || stored.quote.id !== pending.quote.id)) {
    throw new Error('Another payment is saved for this token. Reopen checkout to check it before continuing.');
  }
  storage.setItem(`funded.boost.resolved.${mint}`, JSON.stringify({ quote: pending.quote, signature: pending.pendingSignature, proof }));
  storage.removeItem(`funded.boost.pending.${mint}`);
  return resolution;
}

export function archiveVerifiedBoostFromHistory(pending, history, storage = globalThis.localStorage) {
  if (!pending?.pendingSignature || !pending.quote || !Array.isArray(history)) return false;
  const proof = history.find(row => row?.signature === pending.pendingSignature
    && row.quoteId === pending.quote.id && row.mint === pending.quote.mint && row.status === 'finalized');
  if (!proof) return false;
  archiveBoostPayment(pending, proof, storage);
  return true;
}

export async function saveSignedBoostPayment(record, storage = globalThis.localStorage, locks = globalThis.navigator?.locks) {
  const persist = () => {
    const current = readPendingBoost(record.quote.mint, storage);
    if (current && (current.signature !== record.signature || current.quote.id !== record.quote.id)) {
      throw new Error('A payment for this token is already saved. Reopen checkout to verify it before paying again.');
    }
    storage.setItem(`funded.boost.pending.${record.quote.mint}`, JSON.stringify(record));
  };
  // Web Locks coordinate independent tabs sharing the same recovery storage.
  if (locks?.request) return locks.request(`funded.boost.pending.${record.quote.mint}`, persist);
  return persist();
}
