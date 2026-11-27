const MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createMarketingAgencyEligibleRoutes({ respond, store, readMarketCaps = async () => ({}), readSolUsd = async () => null }) {
  return async function handleMarketingAgencyEligible(req, res, url) {
    if (req.method !== 'GET' || url.pathname !== '/api/marketing-agency/eligible') return false;

    // Import env at runtime since it's needed
    const env = process.env;
    const solanaCluster = env.VITE_SOLANA_CLUSTER || 'devnet';

    if (solanaCluster !== 'devnet') {
      respond(res, 200, { agents: {}, scope: 'display-only' });
      return true;
    }

    const state = await store.read();
    const agents = ['x-promotion', 'buyback-100k', 'buyback-300k'];
    const result = {};

    for (const agentId of agents) {
      const launches = Object.values(state.launches || {});
      const eligible = launches
        .filter(l => l.marketingAgency?.selectedAgents?.includes(agentId))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 10)
        .map(launch => ({
          mint: launch.mint,
          name: launch.name,
          symbol: launch.symbol,
          selectedAgents: launch.marketingAgency.selectedAgents,
          updatedAt: launch.updatedAt,
          imageUri: launch.imageUri || null,
          createdAt: launch.createdTimestamp
            ? (launch.createdTimestamp > 1e10
                ? new Date(launch.createdTimestamp).toISOString()
                : new Date(launch.createdTimestamp * 1000).toISOString())
            : launch.updatedAt,
          signature: launch.signature || null,
          // Buyback execution time from v3AgencyExecutions
          buybackExecutedAt: null
        }));
      result[agentId] = eligible;
    }

    // Current market cap, display-only: same bonding-curve/SOL-USD source the
    // budget table below uses, best-effort so a stale or unreadable quote just
    // shows '—' rather than failing the whole response.
    const mints = [...new Set(Object.values(result).flat().map(token => token.mint).filter(mint => MINT_PATTERN.test(mint)))];
    const [caps, quote] = await Promise.all([
      mints.length ? readMarketCaps(mints, { waitMs: 2000 }).catch(() => ({})) : {},
      readSolUsd().catch(() => null),
    ]);
    const quoteAge = Date.now() - Date.parse(quote?.fetchedAt);
    const rate = quote && quoteAge >= 0 && quoteAge < 120000 && Number.isFinite(quote.priceUsd) && quote.priceUsd > 0 ? quote.priceUsd : null;
    for (const tokens of Object.values(result)) for (const token of tokens) {
      const marketCapSol = caps[token.mint]?.marketCapSol;
      token.marketCapUsd = rate && Number.isFinite(marketCapSol) && marketCapSol > 0 ? marketCapSol * rate : null;
    }

    respond(res, 200, { agents: result, scope: 'display-only', cluster: 'devnet' });
    return true;
  };
}