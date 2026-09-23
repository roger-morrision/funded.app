export const CREATOR_SUPPORT_VERSION = 'creator-support-v10';
export const validXId = value => /^\d{1,24}$/.test(String(value || ''));
export const validMint = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
export function normalizeCreatorHandle(value) {
  const handle = String(value || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('Enter an X handle, not a profile URL.');
  return `@${handle}`;
}
export function creatorSupportPreset(handle) {
  return { creatorWalletPercent: 0, holderAirdropPercent: 0, solClaimPercent: 80, xRecipient: normalizeCreatorHandle(handle) };
}
export function creatorAuthorization(profile, mint) {
  return profile?.identityVerified === true && !profile.optedOut && profile.authorizedMints?.includes(mint)
    ? 'creator-authorized' : 'fan-created';
}
export function creatorMilestone(paidLamports) {
  const paid = BigInt(paidLamports || 0);
  const milestones = [10_000_000n, 100_000_000n, 1_000_000_000n, 10_000_000_000n];
  const achieved = milestones.filter(target => paid >= target).at(-1) || 0n;
  const next = milestones.find(target => paid < target) || null;
  return { achievedLamports: achieved.toString(), nextLamports: next?.toString() || null };
}
export function supportShareText(creator, origin) {
  const url = new URL(`/creator/x/${creator.id}`, origin);
  return `Follow support for ${creator.handle} on funded.vip (${creator.cluster}). View coin policies and confirmed receipts. Fan-created coins are not endorsements; tokens can lose all value. ${url}`;
}
