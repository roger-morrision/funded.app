import { escapeHtml } from '../shared/display.js';
import { icon } from '../../../ui-icons.js';
import { activeBoostMultiplier } from '../../../boost-offer.js';
import { formatSignal } from '../../../market-intelligence.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function exploreAssetCardMarkup(
  a,
  {
    verifiedBoosts,
    EXPLORE_CLUSTER,
  },
  {
    formatOnchainAge,
    exploreStageLabel,
    exploreSocialLinksMarkup,
    exploreBoostAmountMarkup,
    verifiedPaidListingPayment,
    explorePaidListingBagMarkup,
    exploreDevnetVolumeLabel,
    exploreDevnetVolume,
    exploreDevnetReserveLabel,
    exploreDevnetReserve,
    exploreMarketCapLabel,
    exploreMarketCapUsd,
    tokenCardAddressesMarkup,
    exploreBoostStatus,
    document = globalThis.document,
  } = {}
) {
  const mint = escapeHtml(a.address || '');
  const tokenUrl = `/token/${encodeURIComponent(a.address || '')}`;
  const age = a.createdTimestamp ? escapeHtml(formatOnchainAge(Number(a.createdTimestamp) * 1000)) : 'Age unavailable';
  return `<article class="token-card-shell asset-card signal-${escapeHtml(a.riskLevel)}" data-search="${escapeHtml(a.symbol)} ${escapeHtml(a.name)} ${mint}" data-mint="${mint}">
    <div class="asset-artwork"><a class="asset-artwork-link" href="${tokenUrl}" aria-label="Open ${escapeHtml(a.name)} token"><i class="asset-icon">${escapeHtml(a.icon)}</i></a><span class="asset-artwork-stage">${escapeHtml(exploreStageLabel(a))}</span><span class="asset-artwork-age">${age}</span><button type="button" class="watch-button" data-mint="${mint}" aria-label="Add ${escapeHtml(a.symbol)} to favorites" aria-pressed="false">${icon('star')}</button>${exploreSocialLinksMarkup(a)}</div>
    <div class="asset-top"><span class="asset-symbol${activeBoostMultiplier(verifiedBoosts[a.address]) >= 500 ? ' golden-ticker' : ''}">${escapeHtml(a.symbol)} ${exploreBoostAmountMarkup(a.address)}</span><p class="asset-name"><a class="asset-title-link" href="${tokenUrl}">${escapeHtml(a.name)}</a></p></div>
    <div class="asset-status"><span class="asset-status-badge">${verifiedPaidListingPayment(a) ? 'Paid listing' : a.promotionTier === 'standard' ? 'Standard launch' : a.promotionTier ? 'Promoted launch' : 'Tier unavailable'}</span>${explorePaidListingBagMarkup(a)}<span class="asset-meta">${escapeHtml(exploreStageLabel(a))} · ${age}</span></div>
    <div class="asset-signal-row"><span>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetVolumeLabel(a) : '24h volume'} <b>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetVolume(a) : formatSignal(a.volume24hUsd, ' USD')}</b></span><span>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetReserveLabel(a) : 'Liquidity'} <b>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetReserve(a) : formatSignal(a.liquidityUsd, ' USD')}</b></span></div>
    <div class="asset-bottom"><span class="asset-value" title="${verifiedPaidListingPayment(a) && a.complete == null ? 'Market cap unavailable without verified market data' : `Estimated market capitalization from the confirmed ${a.migrated === true ? 'PumpSwap pool' : 'Pump curve'} snapshot`}">${escapeHtml(exploreMarketCapLabel(a))} · ${escapeHtml(exploreMarketCapUsd(a))}</span><span class="asset-change">${escapeHtml(a.migrated === true ? 'Pool change unindexed' : a.change)}</span></div>
    ${tokenCardAddressesMarkup(a.address)}
    <div class="asset-actions"><button type="button" class="share-asset" data-share-symbol="${escapeHtml(a.symbol)}" data-share-name="${escapeHtml(a.name)}" data-share-mint="${mint}">${icon('share')}<span>Share</span></button><button type="button" class="explore-boost-button" data-boost-mint="${mint}" aria-label="Boost options for ${escapeHtml(a.name)}">${icon('boost')}<span>Boost</span></button></div>
    ${activeBoostMultiplier(verifiedBoosts[a.address]) ? `<div class="asset-boost-row"><span>BOOST <b>${escapeHtml(exploreBoostStatus(a.address))}</b></span></div>` : ''}
  </article>`;
}

export function decorateExploreAssetCard(
  card,
  asset,
  launch,
  {
    exploreProviderStatus,
    exploreWindow,
    EXPLORE_CLUSTER,
  },
  {
    verifiedLaunchPolicyForMint,
    loadPortfolioLogo,
    promotionElement,
    formatExploreUsd,
    formatVerifiedPercent,
    formatExploreTradeCount,
    exploreExplorer,
    document = globalThis.document,
  } = {}
) {
  loadPortfolioLogo(card, launch);
    const promotion = promotionElement(asset.address, true);
    if (promotion) card.querySelector('.asset-status')?.append(promotion);
    if (exploreProviderStatus.includes('stale')) card.querySelector('.asset-status-badge').textContent = 'Last verified · stale';
    const proof = document.createElement('a');
    proof.className = 'asset-proof-link';
    proof.href = exploreExplorer(`address/${encodeURIComponent(asset.address)}`);
    proof.target = '_blank';
    proof.rel = 'noopener noreferrer';
    proof.textContent = 'Mint proof ↗';
    card.querySelector('.asset-actions')?.prepend(proof);
    if (EXPLORE_CLUSTER === 'devnet') {
      const activity = card.querySelector('.asset-signal-row span:first-child');
      if (activity) activity.innerHTML = `${exploreWindow} traded <b>${escapeHtml(formatExploreUsd(asset.windowVolumeSol, { partial: asset.windowCoverage === 'partial' }))}</b>`;
    }
    if (typeof asset.mintAuthorityRevoked === 'boolean' && typeof asset.freezeAuthorityRevoked === 'boolean') {
      const authorities = document.createElement('div');
      authorities.className = 'asset-authorities';
      authorities.innerHTML = `<span class="${asset.mintAuthorityRevoked ? 'revoked' : 'active'}" title="Mint authority ${asset.mintAuthorityRevoked ? 'revoked' : 'active'} on the verified mint account">Mint ${asset.mintAuthorityRevoked ? 'revoked' : 'active'}</span><span class="${asset.freezeAuthorityRevoked ? 'revoked' : 'active'}" title="Freeze authority ${asset.freezeAuthorityRevoked ? 'revoked' : 'active'} on the verified mint account">Freeze ${asset.freezeAuthorityRevoked ? 'revoked' : 'active'}</span>`;
      card.querySelector('.asset-bottom')?.before(authorities);
    }
    if (asset.benefitPolicyVerified) {
      const benefits = document.createElement('div');
      benefits.className = 'asset-benefit-policy';
      benefits.setAttribute('aria-label', 'Token allocation and creator-fee policy');
      const promotionLabel = asset.promotionTier === 'standard' ? '' : `${asset.promotionTier} promotion`;
      benefits.innerHTML = `${promotionLabel ? `<span class="promotion">${escapeHtml(promotionLabel)}</span>` : ''}<span class="${asset.communityAirdropPercent > 0 ? 'positive' : 'zero'}">Airdrop ${escapeHtml(formatVerifiedPercent(asset.communityAirdropPercent))}</span><span class="${asset.holderFeePercent > 0 ? 'positive' : 'zero'}">Holders ${escapeHtml(formatVerifiedPercent(asset.holderFeePercent))}</span><span class="${asset.xFeePercent > 0 ? 'positive' : 'zero'}">X ${escapeHtml(formatVerifiedPercent(asset.xFeePercent))}</span><span class="${asset.creatorFeePercent > 0 ? 'positive' : 'zero'}">Creator ${escapeHtml(formatVerifiedPercent(asset.creatorFeePercent))}</span>`;
      const disclosure = document.createElement('details');
      disclosure.className = 'asset-policy-details';
      const summary = document.createElement('summary');
      summary.textContent = `Rewards · ${formatVerifiedPercent(asset.holderFeePercent)} of creator fees to holders`;
      const basis = document.createElement('p');
      basis.textContent = 'Airdrop: % of token supply. Holder, X and creator shares: % of gross collected creator fees. Allocations are not payments.';
      disclosure.append(summary, benefits, basis);
      card.querySelector('.asset-bottom')?.after(disclosure);
    }
    if (EXPLORE_CLUSTER === 'devnet') {
      const flow = document.createElement('div');
      flow.className = 'asset-trade-flow';
      const count = formatExploreTradeCount(asset.windowTradeCount, asset.windowCoverage);
      const buys = formatExploreTradeCount(asset.windowBuyCount, asset.windowCoverage);
      const sells = formatExploreTradeCount(asset.windowSellCount, asset.windowCoverage);
      flow.innerHTML = `<span>${exploreWindow} trades <b>${count}</b></span>${asset.windowBuyCount != null && asset.windowSellCount != null ? `<span class="asset-flow-buy">${buys} ${asset.windowBuyCount === 1 ? 'buy' : 'buys'}</span><span class="asset-flow-sell">${sells} ${asset.windowSellCount === 1 ? 'sell' : 'sells'}</span>` : '<span>Split unavailable</span>'}${asset.windowTraderCount != null ? `<span title="Distinct wallets in confirmed Pump trade events">${formatExploreTradeCount(asset.windowTraderCount, asset.windowCoverage)} ${asset.windowTraderCount === 1 ? 'trader' : 'traders'}</span>` : ''}`;
      card.querySelector('.asset-bottom')?.before(flow);
      if (asset.windowBuyCount != null && asset.windowSellCount != null && asset.windowTradeCount > 0) {
        const buyPercent = Math.max(0, Math.min(100, asset.windowBuyCount / asset.windowTradeCount * 100));
        const pressure = document.createElement('div');
        pressure.className = 'asset-buy-pressure';
        pressure.setAttribute('aria-label', `${exploreWindow} buy share ${buyPercent.toFixed(0)} percent of scanned trades`);
        pressure.innerHTML = `<span>Buy share <b>${buyPercent.toFixed(0)}%</b></span><i><em></em></i>`;
        pressure.querySelector('em').style.width = `${buyPercent}%`;
        card.querySelector('.asset-bottom')?.before(pressure);
      }
    }
    if (asset.complete !== false || asset.curveProgressPercent == null || !Number.isFinite(Number(asset.curveProgressPercent))) return;
    const percent = Math.max(0, Math.min(100, Number(asset.curveProgressPercent)));
    const progress = document.createElement('div');
    progress.className = 'asset-curve-progress';
    progress.innerHTML = `<span>Curve filled <b>${percent.toFixed(0)}%</b></span><i><em></em></i>`;
    progress.querySelector('em').style.width = `${percent}%`;
    card.querySelector('.asset-bottom')?.before(progress);
}
