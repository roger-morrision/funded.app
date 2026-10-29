import bs58 from 'bs58';

export const COMMUNITY_CLAIM_PENDING_KEY = 'funded.vip.pending-community-claim.v1';

function validBytes(value, length) {
  if (typeof value !== 'string' || value.length > 128) return false;
  try { return bs58.decode(value).length === length; } catch { return false; }
}

export function validatePendingCommunityClaim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !validBytes(value.mint, 32) || !validBytes(value.wallet, 32)
    || !validBytes(value.signature, 64) || value.cluster !== 'devnet') {
    throw new Error('Saved community claim details are invalid. Keep the original receipt; do not sign another claim.');
  }
  return { mint:value.mint, wallet:value.wallet, signature:value.signature, cluster:'devnet' };
}

export function readPendingCommunityClaim(storage = globalThis.localStorage) {
  let raw;
  try { raw = storage.getItem(COMMUNITY_CLAIM_PENDING_KEY); }
  catch { throw new Error('Community claim recovery storage is unavailable. Do not sign another claim.'); }
  if (raw === null) return null;
  try { return validatePendingCommunityClaim(JSON.parse(raw)); }
  catch { throw new Error('Saved community claim details cannot be read. Do not sign another claim.'); }
}

function same(one, two) { return JSON.stringify(one) === JSON.stringify(two); }

export function savePendingCommunityClaim(value, storage = globalThis.localStorage) {
  const pending = validatePendingCommunityClaim(value);
  const existing = readPendingCommunityClaim(storage);
  if (existing && !same(existing, pending)) throw new Error('Another signed community claim needs verification before a new one.');
  try { storage.setItem(COMMUNITY_CLAIM_PENDING_KEY, JSON.stringify(pending)); }
  catch { throw new Error('Signed community claim recovery could not be saved. No claim was sent.'); }
  if (!same(readPendingCommunityClaim(storage), pending)) throw new Error('Signed community claim recovery could not be confirmed. No claim was sent.');
  return pending;
}

export function clearPendingCommunityClaim(value, storage = globalThis.localStorage) {
  const pending = validatePendingCommunityClaim(value);
  const existing = readPendingCommunityClaim(storage);
  if (!existing) return;
  if (!same(existing, pending)) throw new Error('A different community claim is saved. Its recovery record was kept.');
  try { storage.removeItem(COMMUNITY_CLAIM_PENDING_KEY); }
  catch { throw new Error('Community claim recovery could not be cleared. Verify the original receipt before another claim.'); }
  if (readPendingCommunityClaim(storage)) throw new Error('Community claim recovery remains saved. Do not sign another claim.');
}
