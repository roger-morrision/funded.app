const PAID_PACKAGES = Object.freeze({
  boost: { label: 'Boost', icon: '✦' },
  pro: { label: 'Pro', icon: '◆' },
  premier: { label: 'Premier', icon: '★' },
});

export function verifiedPromotionBadge(launch) {
  const promotion = launch?.creatorLaunchBurn;
  const type = PAID_PACKAGES[promotion?.tier];
  if (!launch?.onchainVerified || !type || promotion.status !== 'verified'
    || promotion.receipt?.verified !== true || promotion.receipt?.atomicWithPumpLaunch !== true
    || promotion.receipt?.signature !== launch.signature) return null;
  return { tier: promotion.tier, label: `${type.icon} ${type.label}`, amountTokens: promotion.amountTokens,
    signature: promotion.receipt.signature };
}
