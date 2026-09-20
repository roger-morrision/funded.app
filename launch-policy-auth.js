import { PublicKey } from '@solana/web3.js';
import { validateCommunityAllocation } from './airdrop-policy.js';
import { validateFeeDistribution } from './distribution-policy.js';

export function canonicalLaunchPolicy(input = {}) {
  const communityAllocation = Number(input.communityAllocation);
  if (!validateCommunityAllocation(communityAllocation).valid) throw new Error('Community allocation must be between 3% and 50%.');
  const shares = input.feeDistribution?.creatorDirected?.shares || {};
  const xRecipient = input.feeDistribution?.creatorDirected?.recipients?.xAccount || '';
  const distribution = validateFeeDistribution({ ...shares, xRecipient });
  if (!distribution.valid) throw new Error('Creator-directed shares or X recipient are invalid.');
  const xUserId = String(input.xUserId || '').trim();
  if (distribution.shares.solClaimPercent > 0 && !/^\d{1,24}$/.test(xUserId)) throw new Error('A verified, stable X user ID is required for X-linked launches.');
  const burn = input.creatorLaunchBurn;
  const promotion = burn && burn.tier !== 'standard' ? {
    tier: String(burn.tier || ''),
    amountTokens: Number(burn.amountTokens),
    fundedMint: new PublicKey(String(burn.fundedMint || '')).toBase58(),
  } : null;
  return {
    mint: new PublicKey(String(input.mint || '')).toBase58(),
    creatorWallet: new PublicKey(String(input.creatorWallet || '')).toBase58(),
    cluster: String(input.cluster || ''),
    transaction: String(input.signature || input.pumpFeeRoute?.transaction || '').trim(),
    feeRouter: new PublicKey(String(input.pumpFeeRoute?.router || '')).toBase58(),
    communityAllocation,
    creatorWalletPercent: distribution.shares.creatorWalletPercent,
    holderAirdropPercent: distribution.shares.holderAirdropPercent,
    solClaimPercent: distribution.shares.solClaimPercent,
    xRecipient: distribution.shares.solClaimPercent > 0 ? xRecipient : '',
    ...(distribution.shares.solClaimPercent > 0 ? { xUserId } : {}),
    ...(promotion ? { promotion } : {}),
  };
}

export function launchPolicyStatement(input) {
  return `funded.app launch policy v1\n${JSON.stringify(canonicalLaunchPolicy(input))}`;
}
