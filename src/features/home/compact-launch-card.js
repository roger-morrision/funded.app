import {escapeHtml} from '../shared/display.js';

export function compactLaunchCard(item,{value,change,changeClass,ageLabel,freshness}) {
 const mint=String(item.address||''),symbol=item.symbol||'TOKEN',name=item.name||symbol;
 return `<article class="home-new-token-card" data-mint="${escapeHtml(mint)}" data-logo-mint="${escapeHtml(mint)}">
  <a class="home-new-token-link" href="/token/${encodeURIComponent(mint)}" aria-label="Open ${escapeHtml(name)} token details"></a>
  <div class="home-new-token-art"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(item.icon||symbol.slice(0,2))}</span></div>
  <div class="home-new-token-body"><div class="home-new-token-heading"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small title="${escapeHtml(symbol)}">$${escapeHtml(symbol)}</small></div>
   <span class="home-launch-media-package"></span>
   <div class="home-new-token-market"><strong title="Market cap · ${escapeHtml(freshness)}">${escapeHtml(value)}</strong><span class="${changeClass}" title="24h market-cap change">${escapeHtml(change)}</span></div>
   <div class="home-new-token-meta"><span title="${escapeHtml(mint)}">${escapeHtml(mint.slice(0,4))}…${escapeHtml(mint.slice(-4))}</span><span>${escapeHtml(ageLabel)}</span></div>
  </div></article>`;
}
