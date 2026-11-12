import {escapeHtml as esc} from '../shared/display.js';
import { callFigures, usdShort, signedUsd, multipleBadge, openCallShare } from '../callouts/call-share.js';
import { solUsdPrice } from '../shared/token-identity.js';
import { icon } from '../../../ui-icons.js';

const short = value => `${String(value).slice(0,4)}…${String(value).slice(-4)}`;
const mintValid = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value || '');
function age(value) {
  const seconds = Math.max(0, Math.floor((Date.now()-Date.parse(value))/1000));
  return !Number.isFinite(seconds) ? '' : seconds<60 ? 'now' : seconds<3600 ? `${Math.floor(seconds/60)}m` : seconds<86400 ? `${Math.floor(seconds/3600)}h` : `${Math.floor(seconds/86400)}d`;
}
// Home "Chat & calls" card: caller, change since the call and time; the message;
// a token row (market cap, holding value and its change since the call for calls).
export function communityMessageMarkup(row, token = {}, solUsd = null, wallet = null) {
  const hue = [...String(row.author)].reduce((sum,c) => sum+c.charCodeAt(0),0)%360;
  const change = row.callout?.marketChangePercent;
  const calledCapSol = row.callout?.marketCapSol;
  const currentCapSol = Number.isFinite(change) && calledCapSol > 0 ? calledCapSol * (1 + change / 100) : null;
  const f = row.callout ? callFigures({ calledCapSol, currentCapSol, holdingPercent: row.callout.holdingPercent, solUsd }) : null;
  const badge = f ? multipleBadge(f.multiple) : '';
  const trend = f && Number.isFinite(f.multiple) ? (f.multiple >= 1.05 ? 'up' : f.multiple <= 0.95 ? 'down' : 'flat') : 'flat';
  const symbol = token.symbol ? `$${token.symbol}` : short(row.mint);
  const logo = /^https:\/\//.test(token.logoUri || token.imageUri || '') ? `<img src="${esc(token.logoUri || token.imageUri)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(String(token.symbol || '?').slice(0,2).toUpperCase());
  const holdChange = f && Number.isFinite(f.holdChangeUsd) ? `<span class="home-call-pnl" data-trend="${f.holdChangeUsd >= 0 ? 'up' : 'down'}">${esc(signedUsd(f.holdChangeUsd))}</span>` : '';
  const figures = f ? `<span><i>MC</i> ${esc(usdShort(f.currentCapUsd ?? f.calledCapUsd))}</span>${Number.isFinite(f.holdUsd) ? `<span><i>Hold</i> ${esc(usdShort(f.holdUsd))}</span>` : ''}${holdChange}` : '';
  return `<article class="home-community-message home-call-card${row.callout ? ' is-call' : ''}" data-message-id="${esc(row.id)}">
    <header><span class="home-call-avatar" style="--author-hue:${hue}" aria-hidden="true">${esc(String(row.author).slice(0,2))}</span><a class="home-community-author" style="--author-hue:${hue}" href="/wallet/${encodeURIComponent(row.author)}">${esc(short(row.author))}</a>${badge ? `<b class="home-call-x" data-trend="${trend}" title="Market cap now vs. at the call">${esc(badge)}</b>` : row.callout ? '' : '<span class="home-community-kind">Chat</span>'}<time datetime="${esc(row.createdAt)}" title="${esc(row.createdAt)}">${esc(age(row.createdAt))}</time></header>
    <p>${esc(row.text)}</p>
    <div class="home-call-foot"><a class="home-community-token home-call-token" data-logo-mint="${esc(row.mint)}" href="/token/${encodeURIComponent(row.mint)}"><span class="home-token-avatar" aria-hidden="true">${logo}</span><strong>${esc(symbol)}</strong>${figures}</a><div class="home-call-actions callout-actions"><button type="button" class="callout-like" data-like-message="${esc(row.id)}" data-mint="${esc(row.mint)}" data-liked="${wallet && Array.isArray(row.likedBy) && row.likedBy.includes(wallet) ? 'true' : 'false'}" aria-label="Like" title="Like">${icon('heart')}<span class="callout-like-count">${Number(row.likeCount) > 0 ? esc(String(row.likeCount)) : ''}</span></button><button type="button" class="callout-comment" data-comment-message="${esc(row.id)}" data-mint="${esc(row.mint)}" data-author="${esc(row.author)}" aria-label="Reply in this coin's chat" title="Reply in chat">${icon('chat')}</button><button type="button" class="callout-share" data-share-message="${esc(row.id)}" aria-label="Share" title="Share">${icon('share')}</button></div></div>
  </article>`;
}

export function mountHomeCommunity(app, document = globalThis.document) {
  const board = document.querySelector('.home-launch-board');
  if (!board || board.querySelector('#home-community')) return;
  const coins = document.createElement('div'); coins.className='home-discovery-coins';
  while(board.firstChild) coins.append(board.firstChild);
  board.append(coins); board.classList.add('home-discovery-layout');
  const panel=document.createElement('aside');panel.id='home-community';panel.setAttribute('aria-labelledby','home-community-title');panel.setAttribute('data-inline-status','');
  panel.innerHTML=`<header class="home-community-heading"><h2 id="home-community-title">Calls</h2><a href="#callouts">Open calls ↗</a></header>
    <div class="home-community-feed" tabindex="0" aria-label="Recent calls"><p class="home-community-empty">Loading calls…</p></div>`;
  board.append(panel);
  const feed=panel.querySelector('.home-community-feed');
  let messages=[],loading=false,timer,lastMarkup='';
  const active=()=>document.body.classList.contains('page-route-overview')&&!document.hidden;
  const assets=()=>Array.isArray(app.assets)?app.assets:[];
  const indexed=new Map(),indexedTried=new Map();
  const tokenFor=mint=>assets().find(asset=>asset.address===mint)||indexed.get(mint)||{};
  function loadIndexed(){
    const missing=[...new Set(messages.map(row=>row.mint))].filter(mint=>mintValid(mint)&&!assets().some(asset=>asset.address===mint)
      &&!indexed.has(mint)&&!(Date.now()-(indexedTried.get(mint)||0)<120_000)).slice(0,50);
    if(!missing.length)return;
    missing.forEach(mint=>indexedTried.set(mint,Date.now()));
    app.apiRequest(`/api/tokens/market?mints=${missing.join(',')}`,{signal:AbortSignal.timeout(10000)}).then(result=>{
      for(const row of result?.data?.items||[])if(mintValid(row.mint))indexed.set(row.mint,{symbol:row.symbol||null,name:row.name||null,logoUri:row.logoUri||null});
      lastMarkup='';render();
    }).catch(()=>{});
  }
  function render(){
    if(feed.contains(document.activeElement)&&document.activeElement!==feed)return;
    loadIndexed();
    const solUsd=app.coinSolUsdPrice||solUsdPrice();
    const html=messages.length?messages.filter(row=>row.callout).map(row=>communityMessageMarkup(row,tokenFor(row.mint),solUsd,app.connectedWalletAddress||null)).join(''):'<p class="home-community-empty">No calls yet.</p>';
    if(html!==lastMarkup){const top=feed.scrollTop;feed.innerHTML=html;feed.scrollTop=top;lastMarkup=html;}
    app.loadVerifiedTokenLogos?.(feed);
  }
  async function refresh(){
    if(loading||!active())return;loading=true;
    try{
      const result=await app.apiRequest('/api/token-chat/feed');
      if(!result?.available||!Array.isArray(result.data?.messages))throw new Error('Unavailable');
      // Newest first, as in every chat and call list.
      messages=result.data.messages.slice().sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));if(active())render();
    }catch{if(active()){if(!messages.length)feed.innerHTML='<p class="home-community-empty">Calls are unavailable. Retrying shortly.</p>';}}
    finally{loading=false;}
  }
  function schedule(){clearTimeout(timer);if(active()){void refresh();timer=setTimeout(schedule,30000);}}
  window.addEventListener('funded:token-identities',()=>{lastMarkup='';if(active())render();});
  window.addEventListener('funded:route-change',schedule);
  window.addEventListener('hashchange',()=>setTimeout(schedule,0));
  document.addEventListener('visibilitychange',schedule);
  schedule();
}
