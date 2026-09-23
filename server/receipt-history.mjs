import { createHash } from 'node:crypto';
import { RECEIPT_WINDOW } from './receipt-candidates.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const receiptFingerprint = (kind, record) => createHash('sha256').update(JSON.stringify(canonical({ version:1, kind, record }))).digest('hex');
export function cachedReceiptProof(entry, kind, record) {
  const proof = entry?.proof;
  if (entry?.key !== receiptFingerprint(kind,record) || entry.cluster !== 'devnet' || entry.commitment !== 'finalized'
    || !proof || proof.signature !== record.signature || !Number.isSafeInteger(proof.slot) || proof.slot <= 0) return null;
  if (kind === 'collections') return proof.mint === record.mint && proof.collectedLamports === record.collectedLamports ? proof : null;
  return proof.claimId === (record.claimId || null) && proof.to === record.to && proof.source === record.source
    && proof.amountLamports === Number(record.amountLamports ?? Number(record.amountSol)*1e9) ? proof : null;
}
export function encodeReceiptCursor(key) { return Buffer.from(key,'utf8').toString('base64url'); }
export function decodeReceiptCursor(cursor = '') {
  if (!cursor) return '';
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error('Invalid receipt cursor.');
  const key = Buffer.from(cursor,'base64url').toString('utf8');
  if (!key || Buffer.byteLength(key)>256 || /[\x00-\x1f\x7f]/.test(key) || encodeReceiptCursor(key)!==cursor) throw new Error('Invalid receipt cursor.');
  return key;
}
export function creatorReceiptPage(state, id, cluster, after = '') {
  const entries = Object.entries(state.payouts || {}).filter(([key,row]) => key > after && row.cluster === cluster && row.status === 'paid'
    && typeof row.signature === 'string' && row.signature.length > 0 && String(state.obligations?.[row.obligationId]?.xUserId) === id)
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  const selected = entries.slice(0, RECEIPT_WINDOW);
  const page = { creatorProfiles:{}, launches:{}, obligations:{}, claims:{}, collections:{}, payouts:Object.fromEntries(selected) };
  if (state.creatorProfiles?.[id]) page.creatorProfiles[id] = state.creatorProfiles[id];
  for (const [,row] of selected) {
    const obligation = state.obligations[row.obligationId];page.obligations[row.obligationId] = obligation;
    const claim = state.claims?.[row.claimId]; if (String(claim?.xUserId) === id) page.claims[row.claimId] = claim;
    if (state.collections?.[obligation.claimSignature]) page.collections[obligation.claimSignature] = state.collections[obligation.claimSignature];
    const launch = state.launches?.[obligation.mint]; if (String(launch?.xUserId) === id && launch.cluster === cluster) page.launches[obligation.mint] = launch;
  }
  return structuredClone({ state:page, nextCursor:entries.length>RECEIPT_WINDOW?encodeReceiptCursor(selected.at(-1)[0]):null, checkedPayouts:selected.length });
}
