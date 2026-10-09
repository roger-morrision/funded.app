import { icon } from '../../../ui-icons.js';
import { buildCoinSummary } from '../../../coin-summary-model.js';
import { formatSmallDashboardUsd, formatDashboardQuantity, escapeHtml } from '../shared/display.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function compactCoinSocials(
  {},
  {
    document = globalThis.document,
  } = {}
) {
  const labels = {
    '#coin-explorer-link': ['external', 'Open token on Solana Explorer', 'Explorer unavailable'],
    '#coin-website-link': ['website', 'Open token website', 'Website not provided'],
    '#coin-x-link': ['socialX', 'Open token X profile', 'X profile not provided'],
    '#coin-telegram-link': ['telegram', 'Open token Telegram', 'Telegram not provided'],
    '#coin-discord-link': ['discord', 'Open token Discord', 'Discord not provided'],
    '#coin-share-link': ['share', 'Share token'],
    '#coin-refresh': ['refresh', 'Refresh token data'],
  };
  const socials = document.querySelector('.coin-socials');
  if (!socials) return;
  socials.classList.add('is-compact');
  for (const [selector, [iconName, title, unavailableTitle]] of Object.entries(labels)) {
    const element = socials.querySelector(selector);
    if (!element) continue;
    element.innerHTML = icon(iconName);
    if (element.tagName === 'A' && selector !== '#coin-share-link' && !element.getAttribute('href')) {
      element.hidden = false;
      element.classList.add('is-unavailable');
      element.setAttribute('aria-disabled', 'true');
      element.title = unavailableTitle;
      element.setAttribute('aria-label', unavailableTitle);
    } else if (element.tagName === 'A' && element.getAttribute('href')) {
      element.hidden = false;
      element.classList.remove('is-unavailable');
      element.removeAttribute('aria-disabled');
      element.title = title;
      element.setAttribute('aria-label', title);
    } else {
      element.title = title;
      element.setAttribute('aria-label', title);
    }
  }
}

export function renderCoinSummary(
  {
    coinSummaryLaunch,
    coinSummaryLedgerMint,
    currentCoinFeeOverview,
    coinMarketActivity,
    coinSolUsdPrice,
    coinSolUsdValues,
    EXPLORE_CLUSTER,
  },
  {
    getCoinMintAddress,
    document = globalThis.document,
  } = {}
) {
  const root = document.querySelector('#coin-summary-dashboard');
  const grid = document.querySelector('#coin-summary-grid');
  if (!root || !grid) return;
  const summary = buildCoinSummary({
    mint:getCoinMintAddress(), cluster:EXPLORE_CLUSTER, launch:coinSummaryLaunch,
    ledgerMint:coinSummaryLedgerMint, overview:currentCoinFeeOverview,
    market:coinMarketActivity, solUsd:coinSolUsdPrice, tokenSpotSol:coinSolUsdValues.spot,
  });
  root.hidden = !summary.visible;
  if (!summary.visible) { grid.replaceChildren(); return; }
  const source = document.querySelector('#coin-summary-source');
  if (source) source.textContent = `Verified launch`;
  grid.innerHTML = summary.cards.filter(item => item.id !== 'volume').map(item => {
    const value = item.amount == null ? item.unit === 'USD' ? '$—' : '—'
      : item.unit === 'USD' ? formatSmallDashboardUsd(item.amount, { partial:item.id === 'volume' && item.state === 'partial' })
        : formatDashboardQuantity(item.amount);
    return `<article class="coin-summary-card" data-metric="${escapeHtml(item.id)}" data-state="${escapeHtml(item.state)}"><span class="coin-summary-icon" aria-hidden="true">${escapeHtml(item.icon)}</span><div><small>${escapeHtml(item.label)}</small><span class="coin-summary-value"><strong>${escapeHtml(value)}</strong><b>${escapeHtml(item.unit)}</b></span><em>${escapeHtml(item.note)}</em></div></article>`;
  }).join('');
}
