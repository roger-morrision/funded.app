import bs58 from 'bs58';

export const COMMUNITY_FUNDING_PENDING_KEY = 'funded.vip.pending-community-funding.v1';

function publicBytes(value, length) {
  if (typeof value !== 'string' || value.length > 128) return false;
  try { return bs58.decode(value).length === length; } catch { return false; }
}

export function validatePendingCommunityFunding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !publicBytes(value.mint, 32) || !publicBytes(value.wallet, 32)
    || !publicBytes(value.signature, 64) || value.cluster !== 'devnet') {
    throw new Error('Saved reserve funding details are invalid. Keep the original receipt; do not sign another transfer.');
  }
  return { mint:value.mint, wallet:value.wallet, signature:value.signature, cluster:'devnet' };
}

export function readPendingCommunityFunding(storage = globalThis.localStorage) {
  let raw;
  try { raw = storage.getItem(COMMUNITY_FUNDING_PENDING_KEY); }
  catch { throw new Error('Reserve funding recovery storage is unavailable. Do not sign another transfer.'); }
  if (raw === null) return null;
  try { return validatePendingCommunityFunding(JSON.parse(raw)); }
  catch { throw new Error('Saved reserve funding details cannot be read. Do not sign another transfer.'); }
}

function same(one, two) { return JSON.stringify(one) === JSON.stringify(two); }

export function savePendingCommunityFunding(value, storage = globalThis.localStorage) {
  const pending = validatePendingCommunityFunding(value);
  const existing = readPendingCommunityFunding(storage);
  if (existing && !same(existing, pending)) throw new Error('Another signed reserve transfer needs verification before a new one.');
  try { storage.setItem(COMMUNITY_FUNDING_PENDING_KEY, JSON.stringify(pending)); }
  catch { throw new Error('Signed reserve transfer recovery could not be saved. No transfer was sent.'); }
  if (!same(readPendingCommunityFunding(storage), pending)) throw new Error('Signed reserve transfer recovery could not be confirmed. No transfer was sent.');
  return pending;
}

export function clearPendingCommunityFunding(value, storage = globalThis.localStorage) {
  const pending = validatePendingCommunityFunding(value);
  const existing = readPendingCommunityFunding(storage);
  if (!existing) return;
  if (!same(existing, pending)) throw new Error('A different reserve transfer is saved. Its recovery record was kept.');
  try { storage.removeItem(COMMUNITY_FUNDING_PENDING_KEY); }
  catch { throw new Error('Reserve funding recovery could not be cleared. Verify the original receipt before another transfer.'); }
  if (readPendingCommunityFunding(storage)) throw new Error('Reserve funding recovery remains saved. Do not sign another transfer.');
}
