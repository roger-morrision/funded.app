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
  panel.innerHTML=`<header class="home-community-heading"><h2 id="home-community-title">Chat &amp; calls</h2><a href="#callouts">Open calls ↗</a></header>
    <div class="home-community-feed" tabindex="0" aria-label="Recent community messages"><p class="home-community-empty">Loading conversations…</p></div>
    <form class="home-community-form"><label for="home-community-token">Post about a coin</label><select id="home-community-token" required><option value="">Choose a coin</option></select>
    <label class="visually-hidden" for="home-community-text">Message</label><textarea id="home-community-text" maxlength="280" rows="2" placeholder="Share a message…" required></textarea>
    <button type="submit">Connect wallet to chat</button><small>Holding this coin &amp; post your message to call this coin.</small></form>
    <p class="home-community-status" role="status"></p>`;
  board.append(panel);
  const feed=panel.querySelector('.home-community-feed'),form=panel.querySelector('form'),select=form.querySelector('select'),input=form.querySelector('textarea'),button=form.querySelector('button'),status=panel.querySelector('[role="status"]');
  let messages=[],loading=false,timer,lastMarkup='',busy=false;
  const active=()=>document.body.classList.contains('page-route-overview')&&!document.hidden;
  const assets=()=>Array.isArray(app.assets)?app.assets:[];
  // Tokens discussed in chat but outside the Richpad feed: symbol and logo from the indexed market route.
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
  function updateIdentity(){button.textContent=app.connectedWalletAddress ? (app.tokenChatSessionReady?.()?'Post':'Sign in & post') : 'Connect wallet to chat';}
  function updateCoins(){
    if(document.activeElement===select && select.options.length>1)return;
    const selected=select.value,choices=new Map();
    for(const row of assets()) if(mintValid(row.address)) choices.set(row.address,row.symbol||short(row.address));
    for(const row of messages) if(mintValid(row.mint)&&!choices.has(row.mint)) choices.set(row.mint,tokenFor(row.mint).symbol||short(row.mint));
    select.innerHTML='<option value="">Choose a coin</option>'+[...choices].map(([mint,symbol])=>`<option value="${esc(mint)}">${esc(symbol)} · ${esc(short(mint))}</option>`).join('');
    if(choices.has(selected))select.value=selected;
  }
  function render(){
    // Do not disturb a focused token link while someone is using the feed.
    if(feed.contains(document.activeElement)&&document.activeElement!==feed)return;
    loadIndexed();
    const solUsd=app.coinSolUsdPrice||solUsdPrice();
    const html=messages.length?messages.map(row=>communityMessageMarkup(row,tokenFor(row.mint),solUsd,app.connectedWalletAddress||null)).join(''):'<p class="home-community-empty">No conversations yet. Choose a coin and start one.</p>';
    if(html!==lastMarkup){const top=feed.scrollTop;feed.innerHTML=html;feed.scrollTop=top;lastMarkup=html;}
    app.loadVerifiedTokenLogos?.(feed);
    updateCoins();
  }
  async function refresh(){
    if(loading||!active())return;loading=true;
    try{
      const result=await app.apiRequest('/api/token-chat/feed');
      if(!result?.available||!Array.isArray(result.data?.messages))throw new Error('Unavailable');
      messages=result.data.messages;if(active())render();
    }catch{if(active()){if(!messages.length)feed.innerHTML='<p class="home-community-empty">Conversations are unavailable. Retrying shortly.</p>';else status.textContent='Showing the last loaded messages. Reconnecting…';}}
    finally{loading=false;}
  }
  function schedule(){clearTimeout(timer);if(active()){void refresh();timer=setTimeout(schedule,30000);}}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    // Connecting alone never publishes a message.
    if(!app.connectedWalletAddress){try{await app.connectWallet();updateIdentity();}catch{status.textContent='Wallet connection was not completed.';}return;}
    if(!mintValid(select.value)||!input.value.trim())return;
    busy=true;button.disabled=true;const mint=select.value,text=input.value.trim();
    try{
      const result=await app.tokenChatRequest('post',{text},mint);
      if(!result?.available||!result.data?.message)throw new Error('Posting could not be confirmed. Check the conversation before retrying.');
      if(input.value.trim()===text)input.value='';
      status.textContent=result.data.calloutStatus==='recorded'?'Call posted.':result.data.calloutStatus==='not-holder'?'Chat posted.':'Chat posted. No new call was recorded; holding, market and call-limit checks apply.';
      await refresh();
    }catch(error){status.textContent=error.message||'Could not post. Please try again.';}
    finally{busy=false;button.disabled=false;updateIdentity();}
  });
  // Share a call from the feed: banner and prefilled post.
  feed.addEventListener('click',event=>{
    // Like toggles with the signed-in wallet; comment replies in the coin's chat.
    const like=event.target.closest('[data-like-message]');
    if(like){
      like.disabled=true;
      void app.tokenChatRequest('like',{messageId:like.dataset.likeMessage},like.dataset.mint).then(result=>{
        if(!result?.available)return;
        like.dataset.liked=String(result.data.liked===true);
        like.querySelector('.callout-like-count').textContent=result.data.likeCount>0?String(result.data.likeCount):'';
        const row=messages.find(item=>item.id===like.dataset.likeMessage);
        if(row){row.likeCount=result.data.likeCount;const by=new Set(row.likedBy||[]);const me=app.connectedWalletAddress;if(me){if(result.data.liked)by.add(me);else by.delete(me);}row.likedBy=[...by];lastMarkup='';}
      }).catch(error=>app.showToast?.(error?.message||'Could not like this post.')).finally(()=>{like.disabled=false;});
      return;
    }
    const comment=event.target.closest('[data-comment-message]');
    if(comment){
      const author=String(comment.dataset.author||'');
      try{sessionStorage.setItem('funded.postBuyCall.text',`@${author.slice(0,4)}…${author.slice(-4)} `);}catch{}
      location.assign(`/token/${encodeURIComponent(comment.dataset.mint)}?compose=callout`);
      return;
    }
    const share=event.target.closest('[data-share-message]');if(!share)return;
    const row=messages.find(item=>item.id===share.dataset.shareMessage);if(!row)return;
    // Chat posts share the coin; calls share the call banner.
    if(!row.callout){void app.openCoinShare?.(row.mint,tokenFor(row.mint).symbol||'Coin',tokenFor(row.mint).name||'');return;}
    const change=row.callout.marketChangePercent,called=row.callout.marketCapSol;
    void openCallShare({call:{id:row.id,mint:row.mint,author:row.author,text:row.text,createdAt:row.createdAt,calledMarketCapSol:called,
      currentMarketCapSol:Number.isFinite(change)&&called>0?called*(1+change/100):null,holdingPercent:row.callout.holdingPercent,token:{symbol:tokenFor(row.mint).symbol||''}},
      solUsd:app.coinSolUsdPrice||solUsdPrice(),wallet:app.connectedWalletAddress||null,referralCode:app.registeredShareCode?.()||''});
  });
  window.addEventListener('funded:token-identities',()=>{lastMarkup='';if(active())render();});
  // Allow connecting without a coin/message, while native validation still protects posts.
  button.addEventListener('click',event=>{if(!app.connectedWalletAddress){event.preventDefault();form.dispatchEvent(new Event('submit',{cancelable:true}));}});
  document.addEventListener('funded:verified-search-index',()=>{updateCoins();if(active())render();});
  window.addEventListener('funded:reward-identity-change',updateIdentity);
  window.addEventListener('funded:route-change',schedule);
  window.addEventListener('hashchange',()=>setTimeout(schedule,0));
  document.addEventListener('visibilitychange',schedule);
  updateCoins();updateIdentity();schedule();
}
