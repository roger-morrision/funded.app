import {escapeHtml} from '../shared/display.js';

export function compactLaunchCard(item,{value,ageLabel,freshness,price='—',creator,holderCount='—',holderTitle='Verified holder count unavailable',progress={value:null,text:'Progress unavailable'},boostMarkup=''}) {
 const mint=String(item.address||''),symbol=item.symbol||'TOKEN',name=item.name||symbol;
 const progressLabel=progress.kind==='migrated'?'Migrated · 100%':progress.text==='On curve'?'Progress unavailable':progress.text;
 const progressAttributes=progress.value===null?'role="img" aria-label="Migration progress unavailable"':`role="progressbar" aria-label="Migration progress for ${escapeHtml(symbol)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.value}" aria-valuetext="${escapeHtml(progressLabel)}"`;
 return `<article class="home-new-token-card" data-mint="${escapeHtml(mint)}" data-logo-mint="${escapeHtml(mint)}">
  <a class="home-new-token-link" href="/token/${encodeURIComponent(mint)}" aria-label="Open ${escapeHtml(name)} token details"></a>
  <div class="home-new-token-art"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(item.icon||symbol.slice(0,2))}</span></div>
  <div class="home-new-token-body"><div class="home-new-token-heading"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small title="${escapeHtml(symbol)}">$${escapeHtml(symbol)}</small>${boostMarkup}</div>
   <span class="home-launch-media-package"></span>
   <div class="home-new-token-market"><span>MC <strong title="Market cap · ${escapeHtml(freshness)}">${escapeHtml(value)}</strong></span><span title="Token price · ${escapeHtml(freshness)}">${escapeHtml(price)}</span></div>
   <div class="home-new-token-meta">${creator?`<span>by <a href="/wallet/${encodeURIComponent(creator)}">${escapeHtml(creator.slice(0,4))}…${escapeHtml(creator.slice(-4))}</a></span>`:''}<span>${escapeHtml(ageLabel)}</span></div>
   <div class="home-new-token-holders" data-inline-status title="${escapeHtml(holderTitle)}"><span>Holders</span><strong>${escapeHtml(holderCount==='—'?'Unavailable':holderCount)}</strong></div>
   <div class="home-new-token-footer"><div class="home-new-token-progress" data-inline-status><div><span>Migration</span><strong>${escapeHtml(progressLabel)}</strong></div><div class="home-new-token-track" ${progressAttributes}>${progress.value===null?'':`<i style="width:${progress.value}%"></i>`}</div></div><a class="card-review-buy" data-review-buy="${escapeHtml(mint)}" data-review-amount="0.2" href="/token/${encodeURIComponent(mint)}?reviewBuy=0.2" title="Review a 0.2 SOL buy">Buy ↗</a></div>
  </div></article>`;
}
