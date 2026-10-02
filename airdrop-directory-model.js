export function airdropClaimState(reserve, nowSeconds = Math.floor(Date.now() / 1000)) {
  const published = reserve?.verified === true && ['drop-active', 'drop-closed'].includes(reserve.status);
  const expiresAt = Number(reserve?.expiresAt);
  const expired = published && (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds);
  const closed = published && (reserve.status === 'drop-closed' || expired);
  const claimActive = published && !closed && reserve.status === 'drop-active';
  const hasReceipts = published && /^\d+$/.test(String(reserve.claimedBaseUnits))
    && BigInt(reserve.claimedBaseUnits) > 0n;
  return {
    published,
    claimActive,
    status: closed ? 'closed' : claimActive ? 'claiming' : 'upcoming',
    label: closed
      ? hasReceipts ? 'Claims closed · receipts indexed' : 'Claims closed · no receipts indexed'
      : claimActive
      ? hasReceipts ? 'Claims open · receipts indexed' : 'Claims open · no receipts indexed'
      : 'Claims pending',
  };
}
