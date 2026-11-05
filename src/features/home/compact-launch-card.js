import {escapeHtml} from '../shared/display.js';

export function compactLaunchCard(item,{value,ageLabel,freshness,price='—',creator,stage='Stage unavailable'}) {
 const mint=String(item.address||''),symbol=item.symbol||'TOKEN',name=item.name||symbol;
 return `<article class="home-new-token-card" data-mint="${escapeHtml(mint)}" data-logo-mint="${escapeHtml(mint)}">
  <a class="home-new-token-link" href="/token/${encodeURIComponent(mint)}" aria-label="Open ${escapeHtml(name)} token details"></a>
  <div class="home-new-token-art"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(item.icon||symbol.slice(0,2))}</span></div>
  <div class="home-new-token-body"><div class="home-new-token-heading"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small title="${escapeHtml(symbol)}">$${escapeHtml(symbol)}</small></div>
   <span class="home-launch-media-package"></span>
   <div class="home-new-token-market"><span>MC <strong title="Market cap · ${escapeHtml(freshness)}">${escapeHtml(value)}</strong></span><span title="Token price · ${escapeHtml(freshness)}">${escapeHtml(price)}</span></div>
   <div class="home-new-token-meta">${creator?`<span>by <a href="/wallet/${encodeURIComponent(creator)}">${escapeHtml(creator.slice(0,4))}…${escapeHtml(creator.slice(-4))}</a></span>`:''}<span>${escapeHtml(ageLabel)}</span></div>
   <div class="home-new-token-footer"><span>${escapeHtml(stage)}</span><a class="card-review-buy" data-review-buy="${escapeHtml(mint)}" data-review-amount="0.2" href="/token/${encodeURIComponent(mint)}?reviewBuy=0.2" title="Review a 0.2 SOL buy">Buy ↗</a></div>
  </div></article>`;
}
