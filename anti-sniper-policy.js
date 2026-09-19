export const ANTI_SNIPER_POLICY = Object.freeze({
  earlyWindowSeconds: 60,
  sameFunderClusterThreshold: 3,
  maximumCreatorEarlyBuyPercent: 2.5,
  rules: Object.freeze(['creator-early-buy', 'funding-cluster', 'same-slot-burst', 'rapid-round-trip']),
});

function timestamp(trade) { return Number(trade.timestamp ?? trade.blockTime ?? 0); }

export function analyzeLaunchActivity({ trades = [], creatorWallet = null, launchTimestamp = 0, policy = ANTI_SNIPER_POLICY } = {}) {
  const creator = String(creatorWallet || '').trim();
  const early = trades.filter(trade => timestamp(trade) >= Number(launchTimestamp) && timestamp(trade) <= Number(launchTimestamp) + policy.earlyWindowSeconds);
  const funders = new Map();
  for (const trade of early) {
    const funder = String(trade.funder || trade.sourceWallet || trade.wallet || '').trim();
    if (funder) funders.set(funder, (funders.get(funder) || 0) + 1);
  }
  const clusters = [...funders.entries()].filter(([, count]) => count >= policy.sameFunderClusterThreshold).map(([funder, count]) => ({ funder, count }));
  const creatorTrades = early.filter(trade => String(trade.wallet || '').trim() === creator);
  const creatorBought = creatorTrades.reduce((sum, trade) => sum + Number(trade.buyPercentSupply || 0), 0);
  const sameSlot = early.reduce((map, trade) => { const slot = String(trade.slot ?? ''); if (slot) map.set(slot, (map.get(slot) || 0) + 1); return map; }, new Map());
  const burstSlots = [...sameSlot.entries()].filter(([, count]) => count >= policy.sameFunderClusterThreshold).map(([slot, count]) => ({ slot, count }));
  const rapidRoundTrips = trades.filter(trade => trade.roundTrip === true || Number(trade.secondsToSell || Infinity) <= 30).length;
  const flags = [];
  if (creatorBought > policy.maximumCreatorEarlyBuyPercent) flags.push('creator-early-buy');
  if (clusters.length) flags.push('funding-cluster');
  if (burstSlots.length) flags.push('same-slot-burst');
  if (rapidRoundTrips > 0) flags.push('rapid-round-trip');
  return {
    status: flags.length ? 'review' : 'clear',
    flags,
    earlyTradeCount: early.length,
    creatorEarlyBuyPercent: creatorBought,
    fundingClusters: clusters,
    burstSlots,
    rapidRoundTrips,
    policy: { ...policy },
  };
}
