// Explore's table view (Grid/Table switch): the same coins as the grid cards,
// one row per coin with the figures traders compare side by side.
import { escapeHtml, formatCompactUsd } from '../shared/display.js';
import { pairChipMarkup } from '../shared/pair-label.js';
import { marketFacts } from './market-facts.js';
import { launchCardProgressState } from '../home/launch-card-view.js';
import { quickBuyLinksMarkup } from '../trade/quick-buy-presets.js';
import { quickBuyMenuMarkup } from '../trade/quick-buy-menu.js';

const percentMarkup = value => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '';
  const number = Number(value);
  return `<small class="explore-table-change ${number >= 0 ? 'is-positive' : 'is-negative'}">${number >= 0 ? '+' : ''}${number.toFixed(2)}%</small>`;
};

function statusMarkup(item, cluster, providerStatus) {
  const facts = marketFacts(item, cluster);
  const migratedVenue = cluster !== 'devnet' && facts.migrated !== true && /^(pumpswap|raydium|meteora|orca)/i.test(String(item.dexId || ''));
  const progress = launchCardProgressState(migratedVenue ? { ...facts, migrated: true } : facts, providerStatus);
  if (progress.kind === 'migrated') return '<span class="explore-table-tag is-migrated">Migrated</span>';
  if (progress.value === null) return '<span class="explore-table-muted">—</span>';
  return `<span class="explore-table-progress" title="${escapeHtml(progress.text)}"><span class="home-launch-progress" role="progressbar" aria-label="Migration progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.value)}"><i style="--launch-progress:${Number(progress.value.toFixed(2))}%"></i></span><small>${Math.floor(progress.value)}%</small></span>`;
}

export function exploreTableMarkup(records, {
  cluster, providerStatus = '', windowLabel = '24h', volumeValue, formatAge, watchMarkup = () => '', paidListing = () => null,
  boostMarkup = () => '', formatPercent = value => `${value}%`,
  // Top 100 reuses this table with its own rank numbers and a ranking note per coin.
  rankOf = (item, index) => index + 1, noteMarkup = () => '',
}) {
  const boltSvg = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M9 1 3 9h4l-1 6 6-8H8z"/></svg>';
  const rows = records.map((item, index) => {
    // Active boost: bolt icon and quantity beside the symbol (no separate tag).
    const boostAmount = String(boostMarkup(item.address) || '').replace(/<[^>]+>/g, '').replace('⚡', '').trim();
    const boostBadge = boostAmount ? `<span class="explore-table-boost" title="Active boost ${escapeHtml(boostAmount)}">${boltSvg}${escapeHtml(boostAmount)}</span>` : '';
    const mint = escapeHtml(item.address || '');
    const href = `/token/${encodeURIComponent(item.address || '')}`;
    const cap = item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : String(item.value || '—').replace(/^MC · /, '');
    const holders = Number.isFinite(Number(item.holders)) && item.holders !== null && item.holders !== '' ? Number(item.holders).toLocaleString() : '—';
    const tags = [
      paidListing(item) ? '<span class="explore-table-tag is-listed">Paid listing</span>' : '',
      item.dexPaid === true ? '<span class="explore-table-tag">DEX paid</span>' : '',
    ].join('');
    // Tier and airdrop exist only for coins launched through richpad.fun; external tokens show a dash.
    const tier = item.benefitPolicyVerified && item.promotionTier ? item.promotionTier.charAt(0).toUpperCase() + item.promotionTier.slice(1) : '—';
    const airdrop = item.benefitPolicyVerified && item.communityAirdropPercent != null ? formatPercent(item.communityAirdropPercent) : '—';
    const logo = cluster !== 'devnet' && /^https:\/\//.test(String(item.imageUri || '')) ? `<img src="${escapeHtml(item.imageUri)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `<tr data-mint="${mint}" data-logo-mint="${mint}">
      <td class="explore-table-rank">${escapeHtml(String(rankOf(item, index)))}</td>
      <td class="explore-table-token"><a href="${href}"><span class="home-token-avatar">${escapeHtml(String(item.symbol || 'T').slice(0, 1))}${logo}</span><span class="explore-table-identity"><strong>${escapeHtml(item.symbol || 'TOKEN')}${boostBadge}</strong><small>${escapeHtml(item.name || 'Unnamed token')}</small></span></a>${pairChipMarkup(item, escapeHtml)}${tags}${noteMarkup(item)}</td>
      <td class="explore-table-num"><strong>${escapeHtml(cap)}</strong>${percentMarkup(item.priceChange24hPercent ?? Number.parseFloat(item.change))}${Number(item.athMarketCapUsd) > 0 ? `<small class="explore-table-ath">ATH ${escapeHtml(formatCompactUsd(Number(item.athMarketCapUsd)))}</small>` : ''}</td>
      <td class="explore-table-num"><strong>${escapeHtml(volumeValue(item))}</strong>${percentMarkup(item.volumeChange24hPercent)}</td>
      <td class="explore-table-num"><strong>${escapeHtml(holders)}</strong>${percentMarkup(item.holderChange24hPercent)}</td>
      <td class="explore-table-age">${item.createdTimestamp ? escapeHtml(formatAge(Number(item.createdTimestamp) * 1000)) : '—'}</td>
      <td class="explore-table-tier">${escapeHtml(tier)}</td>
      <td class="explore-table-airdrop">${escapeHtml(airdrop)}</td>
      <td class="explore-table-status">${statusMarkup(item, cluster, providerStatus)}</td>
      <td class="explore-table-actions">${quickBuyMenuMarkup(item, escapeHtml, quickBuyLinksMarkup(item, escapeHtml, undefined, ' role="menuitem"'))}<button type="button" class="token-card-action-boost" data-boost-mint="${mint}" aria-label="Boost ${escapeHtml(item.symbol || 'token')}" title="Boost"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 1 3 9h4l-1 6 6-8H8z"/></svg></button>${watchMarkup(item.address, item.symbol)}</td>
    </tr>`;
  }).join('');
  return `<div class="explore-table-wrap"><table class="explore-table">
    <thead><tr><th scope="col">#</th><th scope="col">Token</th><th scope="col">Market cap</th><th scope="col">${escapeHtml(windowLabel)} volume</th><th scope="col">Holders</th><th scope="col">Age</th><th scope="col">Tier</th><th scope="col">Airdrop</th><th scope="col">Migration</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
