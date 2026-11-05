import {escapeHtml as esc} from '../shared/display.js';

const short = value => `${String(value).slice(0,4)}…${String(value).slice(-4)}`;
const mintValid = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value || '');
function age(value) {
  const seconds = Math.max(0, Math.floor((Date.now()-Date.parse(value))/1000));
  return !Number.isFinite(seconds) ? '' : seconds<60 ? 'now' : seconds<3600 ? `${Math.floor(seconds/60)}m` : seconds<86400 ? `${Math.floor(seconds/3600)}h` : `${Math.floor(seconds/86400)}d`;
}
export function communityMessageMarkup(row, token = {}) {
  const hue = [...String(row.author)].reduce((sum,c) => sum+c.charCodeAt(0),0)%360;
  const number = value => Number.isFinite(value) ? `${value.toLocaleString(undefined,{maximumFractionDigits:6})} SOL` : 'Unavailable';
  const change = row.callout?.marketChangePercent;
  return `<article class="home-community-message" data-message-id="${esc(row.id)}">
    <header><a class="home-community-author" style="--author-hue:${hue}" href="/wallet/${encodeURIComponent(row.author)}">${esc(short(row.author))}</a><time datetime="${esc(row.createdAt)}" title="${esc(row.createdAt)}">${esc(age(row.createdAt))}</time><span class="home-community-kind">${row.callout?'Call':'Chat'}</span></header>
    <a class="home-community-token" href="/token/${encodeURIComponent(row.mint)}">${esc(token.symbol ? `$${token.symbol}` : short(row.mint))}</a>
    <p>${esc(row.text)}</p>
    ${row.callout ? `<dl class="home-community-metrics"><div><dt>Purchased</dt><dd title="Verified purchase cost is not available for this wallet">${number(row.callout.purchasedSol)}</dd></div><div><dt>P&amp;L</dt><dd title="Wallet cost basis is unavailable; market-cap movement is not wallet P&L">${number(row.callout.pnlSol)}</dd></div></dl>${Number.isFinite(change)?`<small class="home-community-change">MC since call: ${change>=0?'+':''}${change.toFixed(1)}%</small>`:''}`:''}
    <button type="button" class="home-community-report" data-report-message="${esc(row.id)}" data-report-mint="${esc(row.mint)}">Report</button>
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
    <button type="submit">Connect wallet to chat</button><small>Holding this coin? Your post becomes a call when verified.</small></form>
    <p class="home-community-status" role="status"></p>`;
  board.append(panel);
  const feed=panel.querySelector('.home-community-feed'),form=panel.querySelector('form'),select=form.querySelector('select'),input=form.querySelector('textarea'),button=form.querySelector('button'),status=panel.querySelector('[role="status"]');
  let messages=[],loading=false,timer,lastMarkup='',busy=false;
  const active=()=>document.body.classList.contains('page-route-overview')&&!document.hidden;
  const assets=()=>Array.isArray(app.assets)?app.assets:[];
  function updateIdentity(){button.textContent=app.connectedWalletAddress ? (app.tokenChatSessionReady?.()?'Post':'Sign in & post') : 'Connect wallet to chat';}
  function updateCoins(){
    if(document.activeElement===select && select.options.length>1)return;
    const selected=select.value,choices=new Map();
    for(const row of assets()) if(mintValid(row.address)) choices.set(row.address,row.symbol||short(row.address));
    for(const row of messages) if(mintValid(row.mint)&&!choices.has(row.mint)) choices.set(row.mint,short(row.mint));
    select.innerHTML='<option value="">Choose a coin</option>'+[...choices].map(([mint,symbol])=>`<option value="${esc(mint)}">${esc(symbol)} · ${esc(short(mint))}</option>`).join('');
    if(choices.has(selected))select.value=selected;
  }
  function render(){
    // Do not disturb a report button or selection while someone is using the feed.
    if(feed.contains(document.activeElement)&&document.activeElement!==feed)return;
    const html=messages.length?messages.map(row=>communityMessageMarkup(row,assets().find(asset=>asset.address===row.mint))).join(''):'<p class="home-community-empty">No conversations yet. Choose a coin and start one.</p>';
    if(html!==lastMarkup){const top=feed.scrollTop;feed.innerHTML=html;feed.scrollTop=top;lastMarkup=html;}
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
  panel.addEventListener('click',async event=>{
    const report=event.target.closest('[data-report-message]');if(!report||report.disabled)return;
    const reason=globalThis.prompt('Report reason: spam-or-scam, harassment, or impersonation','spam-or-scam');
    if(!['spam-or-scam','harassment','impersonation'].includes(reason))return;
    report.disabled=true;
    try{const result=await app.tokenChatRequest('report',{messageId:report.dataset.reportMessage,reason},report.dataset.reportMint);if(!result?.data?.reported)throw new Error('Report could not be confirmed.');status.textContent='Report submitted.';}
    catch(error){status.textContent=error.message||'Could not report this message.';report.disabled=false;}
  });
  // Allow connecting without a coin/message, while native validation still protects posts.
  button.addEventListener('click',event=>{if(!app.connectedWalletAddress){event.preventDefault();form.dispatchEvent(new Event('submit',{cancelable:true}));}});
  document.addEventListener('funded:verified-search-index',()=>{updateCoins();if(active())render();});
  window.addEventListener('funded:reward-identity-change',updateIdentity);
  window.addEventListener('funded:route-change',schedule);
  window.addEventListener('hashchange',()=>setTimeout(schedule,0));
  document.addEventListener('visibilitychange',schedule);
  updateCoins();updateIdentity();schedule();
}
