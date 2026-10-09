import { LAUNCH_TIER_USD } from '../../../launch-tier-quote.js';
import { formatDashboardUsd, formatCompactUsd, formatDashboardQuantity } from '../shared/display.js';
import { formatTokenBaseUnits } from '../../../funded-burn.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderFundedTokenLanding(
  {
    PROTOCOL_FUNDED_MINT,
    LAUNCH_BURN_TIERS,
    SELECTABLE_LAUNCH_TIERS,
    exploreUpdatedAt,
    assets,
    fundedBuyRoute,
    coinSolUsdPrice,
    fundedBurnState,
    exploreLastVerifiedAt,
    exploreProviderStatus,
    APP_EXPLORER_QUERY,
  },
  {
    validateSolanaMint,
    currentLaunchTierAmounts,
    exploreMarketCapUsd,
    document = globalThis.document,
  } = {}
) {
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  const mintReady = validateSolanaMint(PROTOCOL_FUNDED_MINT).valid === true;
  set('funded-token-mint', mintReady ? PROTOCOL_FUNDED_MINT : 'Mint not configured');
  const copy = document.getElementById('funded-token-copy');
  if (copy) { copy.disabled = !mintReady; copy.dataset.mint = mintReady ? PROTOCOL_FUNDED_MINT : ''; }
  const explorer = document.getElementById('funded-token-chart');
  if (explorer) {
    explorer.hidden = !mintReady;
    if (mintReady) { explorer.href = 'https://explorer.solana.com/address/' + encodeURIComponent(PROTOCOL_FUNDED_MINT) + APP_EXPLORER_QUERY; explorer.target = '_blank'; explorer.rel = 'noopener noreferrer'; explorer.textContent = 'VIEW ON SOLANA ↗'; }
  }
  const tierAmounts = currentLaunchTierAmounts();
  for (const tier of LAUNCH_BURN_TIERS.filter(item => SELECTABLE_LAUNCH_TIERS.has(item.id) && item.id !== 'standard'))
    set('funded-token-' + tier.id, Object.hasOwn(LAUNCH_TIER_USD, tier.id)
      ? tierAmounts?.[tier.id]?.toLocaleString() || '—' : tier.amountTokens.toLocaleString());
  const asset = mintReady && exploreUpdatedAt ? assets.find(item => item.address === PROTOCOL_FUNDED_MINT) : null;
  const pool = fundedBuyRoute.status === 'ready' && fundedBuyRoute.snapshot?.mint === PROTOCOL_FUNDED_MINT
    ? fundedBuyRoute.snapshot : null;
  const solUsdReady = Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0;
  const poolSpotSol = Number(pool?.spotPriceSol);
  const poolReady = pool && Number.isFinite(poolSpotSol) && poolSpotSol > 0;
  const poolPriceUsd = poolReady && solUsdReady ? poolSpotSol * coinSolUsdPrice : null;
  const assetPriceUsd = Number(asset?.priceUsd) > 0 ? Number(asset.priceUsd)
    : Number(asset?.curvePriceSol) > 0 && solUsdReady ? Number(asset.curvePriceSol) * coinSolUsdPrice : null;
  const quote = poolReady ? poolPriceUsd : assetPriceUsd;
  for (const tier of LAUNCH_BURN_TIERS.filter(item => SELECTABLE_LAUNCH_TIERS.has(item.id) && item.id !== 'standard'))
    set('funded-token-' + tier.id + '-note', Object.hasOwn(LAUNCH_TIER_USD, tier.id)
      ? `$${LAUNCH_TIER_USD[tier.id]} target · ${tierAmounts?.[tier.id] ? 'current pool quote' : 'quote unavailable'}`
      : Number.isFinite(quote) && quote > 0 ? `≈ ${formatDashboardUsd(tier.amountTokens * quote)} at current spot` : '$FUNDED burn per launch');
  const poolUnavailableNote = fundedBuyRoute.status === 'unavailable'
    ? /rate limit/i.test(fundedBuyRoute.reason || '') ? 'Solana RPC rate limited' : 'Verified Solana pool unavailable'
    : 'Verified quote unavailable';
  set('funded-token-price', Number.isFinite(quote) ? '$' + quote.toLocaleString(undefined, { maximumSignificantDigits: 6 })
    : poolReady ? poolSpotSol.toPrecision(6) + ' SOL' : '$—');
  set('funded-token-price-note', poolReady ? 'Current Solana pool quote' : Number.isFinite(quote) ? 'Current market estimate' : poolUnavailableNote);
  const supplyReady = fundedBurnState.status === 'ready' && mintReady;
  const supplyTokens = supplyReady ? Number(fundedBurnState.supplyBaseUnits) / 10 ** fundedBurnState.decimals : null;
  const poolCapSol = poolReady && Number.isFinite(supplyTokens) ? poolSpotSol * supplyTokens : null;
  const marketCap = Number.isFinite(poolCapSol) && solUsdReady ? formatCompactUsd(poolCapSol * coinSolUsdPrice)
    : Number.isFinite(poolCapSol) ? poolCapSol.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' SOL'
      : asset ? exploreMarketCapUsd(asset) : '$—';
  set('funded-token-market-cap', marketCap);
  const capValue = document.getElementById('funded-token-market-cap');
  if (capValue) capValue.title = Number.isFinite(poolCapSol) && solUsdReady ? `${formatDashboardUsd(poolCapSol * coinSolUsdPrice)} estimated from the verified pool spot price and live mint supply` : '';
  set('funded-token-market-cap-note', Number.isFinite(poolCapSol) ? 'Pool spot × live mint supply · estimate' : marketCap === '$—' ? poolUnavailableNote : 'Verified market snapshot');
  const burnedTokens = supplyReady ? Number(formatTokenBaseUnits(fundedBurnState.burnedBaseUnits, fundedBurnState.decimals, 2)) : null;
  set('funded-token-burned', Number.isFinite(burnedTokens) ? formatDashboardQuantity(burnedTokens) : '—');
  const burnedValue = document.getElementById('funded-token-burned');
  if (burnedValue) burnedValue.title = Number.isFinite(burnedTokens) ? `${burnedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} $FUNDED from the on-chain supply delta` : '';
  set('funded-token-burned-note', supplyReady ? 'Confirmed supply reduction' : fundedBurnState.status === 'error' ? 'Supply total unavailable' : 'Checking supply');
  const tape = document.getElementById('funded-token-tape-items');
  if (tape) {
    const entries = [];
    if (poolReady) entries.push(['$FUNDED', Number.isFinite(quote) ? '$' + quote.toLocaleString(undefined, { maximumSignificantDigits: 4 }) : poolSpotSol.toPrecision(4) + ' SOL', '/funded']);
    if (Number.isFinite(poolCapSol)) entries.push(['FUNDED MC', marketCap, '/funded']);
    if (Number.isFinite(burnedTokens)) entries.push(['BURNED', burnedTokens.toLocaleString(undefined, { maximumFractionDigits: 0 }), '/funded']);
    if (exploreLastVerifiedAt && !exploreProviderStatus.includes('stale')) {
      for (const item of assets) {
        const cap = exploreMarketCapUsd(item);
        if (!item.address || cap === '$—') continue;
        entries.push([`$${item.symbol || 'TOKEN'}`, cap, `/token/${encodeURIComponent(item.address)}`]);
        if (entries.length >= 8) break;
      }
    }
    tape.replaceChildren();
    if (!entries.length) tape.textContent = 'Waiting for verified Solana market data';
    for (const [label, value, href] of entries) {
      const link = document.createElement('a');
      link.href = href;
      const name = document.createElement('span');
      name.textContent = label;
      const figure = document.createElement('strong');
      figure.textContent = value;
      link.append(name, figure);
      tape.append(link);
    }
  }
}
