import { collectRecentTrades } from './market-intelligence.js';

// Only tokens in the verified Explore feed can be shown. A past trade does not
// imply a current balance, so keep the two reasons separate.
export function followingTokenSources(records, followedWallets, holdingsByWallet = new Map()) {
  const followed = new Set(followedWallets.map(row => row.address));
  const visibleMints = new Set(records.map(record => record.address).filter(Boolean));
  const sources = new Map();
  const source = mint => {
    if (!sources.has(mint)) sources.set(mint, { heldBy: new Set(), tradedBy: new Set() });
    return sources.get(mint);
  };
  for (const wallet of followed) {
    const holdings = holdingsByWallet.get(wallet);
    if (holdings?.status === 'unavailable') continue;
    for (const mint of holdings?.mints || []) {
      if (visibleMints.has(mint)) source(mint).heldBy.add(wallet);
    }
  }
  for (const trade of collectRecentTrades(records, { limit: Number.MAX_SAFE_INTEGER })) {
    if (followed.has(trade.trader) && visibleMints.has(trade.mint)) source(trade.mint).tradedBy.add(trade.trader);
  }
  return sources;
}
