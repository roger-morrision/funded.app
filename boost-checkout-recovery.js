import { boostMemo, boostPackage, boostLamports } from './boost-offer.js';
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const quotePattern = /^boost_\d+_[0-9a-f]{16}$/;

export function validateBoostQuote(quote, { mint, payer, packageId, pricing, reviewedQuote }, now = Date.now()) {
  const selected = boostPackage(packageId);
  const expected = reviewedQuote || pricing?.packages?.find(pack => pack.id === packageId);
  const revision = reviewedQuote?.pricingRevision ?? pricing?.revision;
  if (!selected || !quote || quote.cluster !== 'devnet' || quote.mint !== mint || quote.payer !== payer || quote.packageId !== packageId
    || !quotePattern.test(quote.id) || !addressPattern.test(quote.recipient)
    || !Number.isSafeInteger(quote.lamports) || quote.lamports <= 0
    || !Number.isFinite(quote.solUsd) || quote.solUsd <= 0 || !Number.isFinite(quote.usd) || quote.usd <= 0
    || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= now
    || !Number.isSafeInteger(quote.pricingRevision) || quote.pricingRevision < 0 || quote.pricingRevision !== revision
    || !expected || quote.usd !== expected.usd || quote.usd > 100000 || Math.abs(quote.usd*100-Math.round(quote.usd*100)) > 1e-7
    || quote.multiplier !== selected.multiplier || quote.hours !== selected.hours
    || quote.lamports !== boostLamports(quote.usd,quote.solUsd) || quote.memo !== boostMemo(quote.id)
    || quote.paymentProtocol !== 'journal-v1'
    || (reviewedQuote && ['id','mint','payer','recipient','lamports','solUsd','expiresAt','createdAt','memo','packageId','paymentProtocol']
      .some(key => quote[key] !== reviewedQuote[key]))) {
    throw new Error('The payment quote could not be verified. Request a fresh quote before signing.');
  }
  return quote;
}

export function boostPaymentResolution(data, pending) {
  if (!['finalized', 'failed', 'expired'].includes(data?.status)) return 'pending';
  if (data.signature !== pending.pendingSignature || data.quoteId !== pending.quote?.id || data.cluster !== 'devnet'
    || !Number.isSafeInteger(data.slot) || data.slot < 1 || (data.status === 'failed' && data.commitment !== 'finalized')) {
    throw new Error('The payment receipt does not match this signed payment. Check the original transaction again.');
  }
  if (data.status === 'expired' && (data.commitment !== 'finalized' || data.transactionAbsent !== true
    || !addressPattern.test(data.blockhash) || data.blockhash !== pending.blockhash
    || !Number.isSafeInteger(data.expiryUpperBound) || data.expiryUpperBound<1 || !Number.isSafeInteger(data.finalizedBlockHeight)
    || data.finalizedBlockHeight <= data.expiryUpperBound + 32)) throw Error('Payment expiry proof is incomplete. Check the original transaction again.');
  return data.status;
}

const pendingKey = quote => `funded.boost.pending.${quote.cluster}.${quote.payer}.${quote.mint}`;
export function readPendingBoost(mint, storage = globalThis.localStorage, scope = {}) {
  const key = scope.payer ? pendingKey({mint,cluster:scope.cluster||'devnet',payer:scope.payer}) : `funded.boost.pending.${mint}`;
  const legacy = storage.getItem(`funded.boost.pending.${mint}`);
  const raw = storage.getItem(key) ?? legacy;
  if (raw == null) return null;
  let pending;
  try { pending = JSON.parse(raw); } catch { throw new Error('Saved payment details are unreadable. Keep this device data and contact support before paying again.'); }
  if (!signaturePattern.test(pending?.signature) || pending?.quote?.mint !== mint || !quotePattern.test(pending?.quote?.id)
    || pending.quote.cluster !== 'devnet') throw new Error('Saved payment details could not be verified. Contact support before paying again.');
  if (scope.payer && (pending.quote.payer !== scope.payer || pending.quote.cluster !== (scope.cluster||'devnet'))) return null;
  if (scope.payer && storage.getItem(key) == null) {
    storage.setItem(key,raw);
    storage.removeItem(`funded.boost.pending.${mint}`);
  }
  return pending;
}

// Release only a matching finalized receipt or server-verified expiry + absence.
export function archiveBoostPayment(pending, proof, storage = globalThis.localStorage) {
  const resolution = boostPaymentResolution(proof, pending);
  if (resolution === 'pending') throw new Error('Payment is still being checked.');
  const mint = pending.quote.mint;
  const stored = readPendingBoost(mint, storage, pending.quote);
  if (stored && (stored.signature !== pending.pendingSignature || stored.quote.id !== pending.quote.id)) {
    throw new Error('Another payment is saved for this token. Reopen checkout to check it before continuing.');
  }
  storage.setItem(`funded.boost.resolved.${pending.quote.cluster}.${pending.quote.payer}.${mint}`, JSON.stringify({ quote: pending.quote, signature: pending.pendingSignature, proof }));
  storage.removeItem(pendingKey(pending.quote));
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
    const current = readPendingBoost(record.quote.mint, storage, record.quote);
    if (current && (current.signature !== record.signature || current.quote.id !== record.quote.id)) {
      throw new Error('A payment for this token is already saved. Reopen checkout to verify it before paying again.');
    }
    storage.setItem(pendingKey(record.quote), JSON.stringify(record));
  };
  // Web Locks coordinate independent tabs sharing the same recovery storage.
  if (locks?.request) return locks.request(pendingKey(record.quote), persist);
  return persist();
}
