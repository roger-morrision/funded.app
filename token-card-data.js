const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function tokenCardData({ mint, market = null, policy = null, reserve = null, receipts = null } = {}) {
  const address = mintPattern.test(String(mint || '')) ? String(mint) : '';
  const verifiedPolicy = policy?.onchainVerified === true && policy.mint === address ? policy : null;
  const verifiedMarket = market?.address === address ? market : null;
  const symbol = String(verifiedMarket?.symbol || verifiedPolicy?.symbol || 'TOKEN');
  const name = String(verifiedMarket?.name || verifiedPolicy?.name || 'Unnamed token');
  const launchWallet = mintPattern.test(String(verifiedPolicy?.creatorWallet || '')) ? verifiedPolicy.creatorWallet : '';
  const marketCheckedAt = Date.parse(String(verifiedMarket?.verifiedAt || ''));
  const marketState = verifiedMarket ? 'checked' : 'unavailable';
  const policyState = verifiedPolicy ? 'recorded' : 'unavailable';
  const reserveState = reserve?.verified === true && reserve.mint === address ? 'verified' : 'unverified';
  const receiptState = receipts?.status === 'partial' ? 'partial' : ['onchain-indexed', 'no-records'].includes(receipts?.status) ? 'indexed' : 'unavailable';
  return { mint: address, symbol, name, launchWallet, marketState, policyState, reserveState, receiptState,
    marketCheckedAt: Number.isFinite(marketCheckedAt) ? marketCheckedAt : null };
}

export function tokenCardEvidenceLabel(card) {
  if (card.marketState === 'checked') return 'Market data verified';
  return card.policyState === 'recorded' ? 'Recorded launch policy · market check unavailable' : 'Token verification unavailable';
}

export function formatPolicyTokenCount(value) {
  const raw = String(value ?? '');
  return /^(?:0|[1-9]\d*)$/.test(raw) && BigInt(raw) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? BigInt(raw).toLocaleString('en-US') : '—';
}
