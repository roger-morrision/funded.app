import bs58 from 'bs58';

export const LISTING_PENDING_KEY = 'funded.vip.pending-listing-burn.v1';
function encodedBytes(value, bytes) {
  if (typeof value !== 'string' || value.length > bytes * 2) return false;
  try { return bs58.decode(value).length === bytes; } catch { return false; }
}
export function validatePendingListing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !encodedBytes(value.mint, 32) || !encodedBytes(value.wallet, 32) || !encodedBytes(value.signature, 64)
    || (value.quoteId != null && !/^listing_\d+_[0-9a-f]{16}$/.test(String(value.quoteId)))
    || (value.cluster != null && value.cluster !== 'devnet')
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 256
    || typeof value.symbol !== 'string' || !value.symbol.trim() || value.symbol.length > 64) {
    throw new Error('Saved listing recovery details are invalid. Keep this tab and its data; do not submit another burn.');
  }
  return { mint: value.mint, name: value.name, symbol: value.symbol, wallet: value.wallet,
    signature: value.signature, ...(value.quoteId ? { quoteId:value.quoteId } : {}), cluster: 'devnet' };
}
export function readPendingListing(storage) {
  let raw;
  try { storage ??= globalThis.sessionStorage; raw = storage.getItem(LISTING_PENDING_KEY); }
  catch { throw new Error('Listing recovery storage cannot be read. Payment is paused; restore browser storage access before continuing.'); }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Saved listing recovery details are unreadable. Keep this tab and its data; do not submit another burn.'); }
  return validatePendingListing(value);
}
const matches = (one, two) => JSON.stringify(one) === JSON.stringify(two);
export function savePendingListing(value, storage) {
  try { storage ??= globalThis.sessionStorage; }
  catch { throw new Error('Listing recovery storage is unavailable. No transaction was sent.'); }
  const pending = validatePendingListing(value), existing = readPendingListing(storage);
  if (existing && !matches(existing, pending)) throw new Error('Another signed listing burn needs verification before a new payment.');
  try { storage.setItem(LISTING_PENDING_KEY, JSON.stringify(pending)); }
  catch { throw new Error('Signed burn recovery could not be saved. No transaction was sent.'); }
  if (!matches(readPendingListing(storage), pending)) throw new Error('Signed burn recovery could not be confirmed. No transaction was sent.');
  return pending;
}
export function clearPendingListing(value, storage) {
  try { storage ??= globalThis.sessionStorage; }
  catch { throw new Error('Listing recovery storage is unavailable. The signed receipt must be retained.'); }
  const pending = validatePendingListing(value), existing = readPendingListing(storage);
  if (!existing) return;
  if (!matches(existing, pending)) throw new Error('A different signed listing burn is saved. Its recovery record was kept.');
  try { storage.removeItem(LISTING_PENDING_KEY); }
  catch { throw new Error('The verified result could not clear its recovery record. Keep this tab and retry verification after restoring storage access.'); }
  if (readPendingListing(storage)) throw new Error('The listing recovery record remains saved. Do not submit another burn.');
}
