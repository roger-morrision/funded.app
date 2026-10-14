import { PublicKey } from '@solana/web3.js';

// Freeze first-touch edges at the first qualified V3 fee settlement.
export function v3ReferralUpline({ creatorWallet, attributions = {}, qualifiedAt }) {
  if (!Number.isSafeInteger(qualifiedAt) || qualifiedAt <= 0) return [];
  let child = new PublicKey(creatorWallet).toBase58();
  const seen = new Set([child]), upline = [];
  for (let level = 1; level <= 3; level++) {
    const row = attributions[child];
    const capturedAt = Date.parse(row?.capturedAt || '');
    if (row?.wallet !== child || row?.lock !== 'first-touch'
      || !Number.isFinite(capturedAt) || capturedAt > qualifiedAt * 1000) break;
    const parent = new PublicKey(row.inviterWallet).toBase58();
    if (seen.has(parent)) throw new Error('Referral graph contains a self-link or cycle.');
    seen.add(parent);
    upline.push(parent);
    child = parent;
  }
  return upline;
}

export function v3ReferralEntitlement({ settlement, plan, level }) {
  if (!Number.isInteger(level) || level < 1 || level > 3)
    throw new Error('A V3 referral level from 1 to 3 is required.');
  if (!Array.isArray(settlement?.referralUpline)) return null;
  const recipient = settlement.referralUpline[level - 1];
  if (!recipient) return null;
  const raw = plan?.protocol?.referralLamports?.[level - 1];
  if (!/^(0|[1-9]\d*)$/.test(String(raw)))
    throw new Error('Finalized V3 referral allocation is invalid.');
  const amount = BigInt(raw);
  return amount > 0n ? { level, recipient:new PublicKey(recipient).toBase58(), amount:String(amount) } : null;
}
