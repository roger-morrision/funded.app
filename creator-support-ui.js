import { publicReadFetch as fetch } from './src/lib/public-read-fetch.js';
import { routeGroup } from './src/app/route-group.js';
import {accountPreferences,saveAccountPreference} from './src/features/account/preferences.js';
import { apiRequest } from './client.js';
import {isDevnetImageUri} from './devnet-metadata.js';
import { APP_CLUSTER } from './app-config.js';
import { CREATOR_SUPPORT_VERSION, normalizeCreatorHandle, supportShareText } from './creator-support-model.js';
import './creator-support.css';
import { mountReceiptHistory } from './receipt-history-ui.js';
import { mountUpcomingAnnouncements, mountAnnouncementSettings } from './src/features/experience/creator-announcements.js';
import { mountCreatorBrief, mountCreatorBriefSettings, mountCreatorContentControls } from './src/features/experience/creator-brief-view.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const displayCluster = cluster => cluster === 'devnet' ? 'Solana Devnet' : cluster === 'mainnet-beta' ? 'Solana Mainnet' : cluster;
const sol = amount => `${(Number(amount || 0) / 1e9).toLocaleString(undefined,{maximumFractionDigits:9})} SOL`;
const main = $('.main-content');
let capabilities = null, routeGeneration = 0, directoryGeneration = 0;
const page = document.createElement('section');
page.id = 'creator-support-page'; page.hidden = true; page.className = 'creator-support-page';
main.insertBefore(page, main.querySelector(':scope > .site-footer'));

function setStatus(node, message) { node.textContent = message; }
async function copy(text, status) {
  try { await navigator.clipboard.writeText(text); setStatus(status,'Copied. Review before sharing.'); }
  catch { setStatus(status,`Copy manually: ${text}`); }
}
function safeFollowing() { return accountPreferences().creators; }
function creatorRoute() { return location.hash.match(/^#creator\/(\d{1,24})$/)?.[1] || (!location.hash && location.pathname.match(/^\/creator\/x\/(\d{1,24})\/?$/)?.[1]); }
function routeKind() { return creatorRoute() ? 'creator' : location.hash === '#creators' ? 'directory' : location.hash === '#creator-settings' ? 'settings' : null; }
async function loadCreatorCoinLogos(generation) {
  try {
    const response = await fetch('/api/launches', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const launches = await response.json();
    if (generation !== routeGeneration || !Array.isArray(launches)) return;
    const verified = new Map(launches.filter(launch => launch.onchainVerified === true && launch.cluster === APP_CLUSTER)
      .map(launch => [launch.mint, launch]));
    page.querySelectorAll('.creator-coin-card').forEach(card => {
      const avatar = card.querySelector('.creator-coin-logo');
      const mint = card.dataset.coinMint;
      const launch = verified.get(mint);
      if (!avatar || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)
        || !isDevnetImageUri(launch?.imageUri, mint)) return;
      const sources = [`/devnet-images/${encodeURIComponent(mint)}`, launch.imageUri];
      let next = 0;
      const trySource = () => {
        if (generation !== routeGeneration || !avatar.isConnected || next >= sources.length) return;
        const image = new Image();
        image.alt = '';
        image.decoding = 'async';
        image.onload = () => { if (generation === routeGeneration && avatar.isConnected) avatar.replaceChildren(image); };
        image.onerror = trySource;
        image.src = sources[next++];
      };
      trySource();
    });
  } catch { /* Keep the mint initial when the verified image is unavailable. */ }
}

function syncSupportShortcutState() {
  const current=location.hash||'#overview';
  document.querySelectorAll('.support-shortcuts a').forEach(link=>{
    const destination=link.getAttribute('href');
    const selected=destination===current||(destination==='#creators'&&current.startsWith('#creator/'));
    if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
}

function applySupportPreset(handle) {
  for(const [id,value] of [['creator-wallet-share','0'],['holder-airdrop-share','0'],['x-share','80'],['x-recipient',normalizeCreatorHandle(handle)]]) {
    const input=$(`#${id}`);if(!input)continue;
    input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  }
}

const notice=document.createElement('p');notice.className='support-capability-note';notice.id='support-capability-note';notice.setAttribute('role','status');
notice.textContent='Checking creator support availability…';$('.topbar')?.after(notice);
async function refreshCapabilities() {
  try {
    const result=await apiRequest('/api/capabilities',{signal:AbortSignal.timeout(12000)});
    if(!result.available || result.data?.version!==CREATOR_SUPPORT_VERSION || result.data.cluster!==APP_CLUSTER)throw new Error('Preview API is missing or out of date. Creator support is unavailable; restart the API using the current build.');
    capabilities=result.data;
    notice.textContent=`${displayCluster(APP_CLUSTER)} · Creator support ${capabilities.xPayouts?.ready?'configured; verify each receipt':'not active for payouts'}. Streaming gifts are not connected.`;
  } catch(error) { capabilities=null;notice.textContent=error.message; }
}
void refreshCapabilities();

async function renderDirectory() {
  page.innerHTML=`<header class="creator-directory-header"><div><p class="eyebrow">Creator communities · ${esc(displayCluster(APP_CLUSTER))}</p><h1>Build a community that shares the rewards.</h1><p>Explore creators and the benefits offered by their launches.</p></div><nav class="support-shortcuts" aria-label="Creator actions"><a href="#launch" data-shortcut-icon="＋">Create a coin</a><a href="#creator-settings" data-shortcut-icon="◎">Manage my page</a></nav></header><details class="creator-directory-methods"><summary>About creator listings</summary><p>Discover creators named in verified fee policies or who opted in. A fan-created coin is not an endorsement. Tokens can lose all value.</p></details><div class="creator-directory-tools"><label>Find a creator<input id="creator-search" type="search" placeholder="Name or X handle" maxlength="80"></label><label class="support-check"><input id="creators-followed" type="checkbox">Following</label></div><p id="creator-directory-status" role="status">Loading creators…</p><div id="creator-directory" class="creator-grid creator-directory-grid"></div>`;
  const more=document.createElement('button');more.className='secondary-button';more.textContent='Load more creators';more.hidden=true;page.append(more);let cursor=null;
  const generation=routeGeneration;
  const search=async(append=false)=>{
    if(generation!==routeGeneration)return;
    if(!append){cursor=null;$('#creator-directory').replaceChildren();}
    $('#creator-directory-status').textContent=append?'Loading more creators…':'Loading creators…';
    more.disabled=true;
    const request=++directoryGeneration;
    try {
      const following=safeFollowing();const params=new URLSearchParams({q:$('#creator-search').value});if(cursor)params.set('after',cursor);if($('#creators-followed').checked&&following.length)params.set('ids',following.join(','));
      const result=await apiRequest(`/api/creators?${params}`,{signal:AbortSignal.timeout(10000)});
      if(generation!==routeGeneration||request!==directoryGeneration)return;
      if(!result.available || !Array.isArray(result.data?.creators))throw new Error('Creator directory is unavailable. Try again after the API is updated.');
      const rows=result.data.creators.filter(c=>!$('#creators-followed').checked||following.includes(c.id));
      cursor=result.data.nextCursor;more.textContent='Load more creators';more.hidden=!cursor||($('#creators-followed').checked&&!following.length);
      $('#creator-directory').insertAdjacentHTML('beforeend',rows.map(c=>`<a class="creator-card" href="/creator/x/${esc(c.id)}"><span class="creator-avatar" aria-hidden="true">${esc(c.handle.slice(1,3).toUpperCase())}</span><h2>${esc(c.name)}</h2><p>${esc(c.handle)}</p><span class="support-badge">${c.identityVerified?'X account ownership verified':'Named recipient · unverified ownership'}</span><p>${c.coinCount} verified support ${Number(c.coinCount)===1?'policy':'policies'}</p></a>`).join(''));
      const count=$('#creator-directory').children.length;$('#creator-directory-status').textContent=count?`${count} ${count===1?'creator':'creators'} shown${cursor?' · more available':''}`:'No matching creators yet. No earnings or endorsements are implied.';
    } catch {
      if(generation!==routeGeneration || request!==directoryGeneration)return;
      $('#creator-directory-status').textContent=append?'More creators could not be loaded.':'Creator search is unavailable.';
      more.textContent='Try again';
      more.hidden=false;
    } finally { if(request===directoryGeneration)more.disabled=false; }
  };
  let debounce;more.onclick=()=>search(Boolean(cursor));$('#creator-search').addEventListener('input',()=>{clearTimeout(debounce);directoryGeneration++;more.disabled=true;debounce=setTimeout(()=>search(false),300);});$('#creators-followed').addEventListener('change',()=>search(false));await search();
}

async function renderCreator(id,generation) {
  page.innerHTML='<p role="status">Loading creator and verified support receipts…</p>';
  try {
    const result=await apiRequest(`/api/creators/${id}`,{signal:AbortSignal.timeout(25000)});
    if(generation!==routeGeneration)return;
    if(!result.available || result.data?.id!==id)throw new Error('Creator page unavailable.');
    const c=result.data;
    const hasProof=c.receipts.length>0;
    page.innerHTML=`<a href="#creators">← All creators</a><div class="creator-hero"><span class="creator-avatar" aria-hidden="true">${esc(c.handle.slice(1,3).toUpperCase())}</span><div><p class="eyebrow">Creator support · ${esc(displayCluster(c.cluster))}</p><h1>${esc(c.name)}</h1><a href="https://x.com/${encodeURIComponent(c.handle.slice(1))}" target="_blank" rel="noopener noreferrer">${esc(c.handle)} ↗</a><p>${c.identityVerified?'X account ownership verified.':'Named in a fee policy; account ownership not verified.'} Authorization is shown separately for each coin.</p></div></div>
      <div class="support-actions"><button id="creator-follow">${safeFollowing().includes(id)?'Unfollow':'Follow'}</button><button id="creator-share">Copy creator link</button><button id="creator-share-card">Download share card</button><a class="primary-button" href="#launch" id="creator-support-launch">Create a support coin</a><a href="#payments">Check my claims</a></div><p id="creator-action-status" role="status"></p>
      <p class="support-warning">Support depends on collected trading fees. Fan-created coins are not endorsements. No guaranteed earnings; tokens can lose all value. ${esc(displayCluster(c.cluster))} assets are not evidence of production payments.</p>
      <div class="support-metrics"><article><small>Confirmed support in checked receipts</small><strong>${hasProof?sol(c.paidLamports):'Not verified'}</strong><p>${esc(c.coverage)}</p></article><article><small>Verified support policies</small><strong>${c.coins.length}</strong><p>A policy is not a paid reward.</p></article><article><small>Receipt milestone</small><strong>${hasProof&&c.milestone.achievedLamports!=='0'?sol(c.milestone.achievedLamports):'No verified milestone'}</strong><p>Based only on this receipt window. Not an earnings forecast.</p></article></div>
      <h2>Coins supporting this account</h2><div class="creator-grid">${c.coins.map(coin=>`<article class="token-card-shell creator-card creator-coin-card" data-coin-mint="${esc(coin.mint)}"><a href="/token/${esc(coin.mint)}"><span class="creator-coin-logo" aria-hidden="true">${esc(String(coin.symbol || 'T').slice(0, 1))}</span><h3><strong>${esc(coin.symbol)}</strong><small>${esc(coin.name)}</small></h3></a><span class="support-badge">${coin.authorization==='creator-authorized'?'Creator-authorized':'Fan-created · not endorsed'}</span><p>${coin.sharePercent}% of collected creator fees allocated to this recipient.</p><small>${esc(coin.mint)}</small></article>`).join('')||'<p>No verified support coins yet.</p>'}</div>
      <h2>Creator updates</h2><div class="creator-updates">${c.updates.map(update=>`<article class="creator-card"><p>${esc(update.text)}</p><time>${esc(update.publishAt || update.createdAt)}</time><button data-update-card="${esc(update.id)}">Download update card</button></article>`).join('')||'<p>No verified-account updates yet.</p>'}</div>
      <h2>Confirmed payout receipts</h2><p>Evidence status: ${esc(c.evidenceStatus)}. Missing or partial evidence is never treated as a complete balance.</p><div>${c.receipts.map(receipt=>`<article class="support-receipt"><strong>${sol(receipt.amountLamports)}</strong><a href="https://explorer.solana.com/tx/${esc(receipt.signature)}?cluster=${encodeURIComponent(c.cluster)}" target="_blank" rel="noopener noreferrer">Verify payout ↗</a><button data-share-receipt="${esc(receipt.signature)}">Copy receipt link</button><button data-receipt-card="${esc(receipt.signature)}">Download receipt card</button></article>`).join('')||'<p>No matched collection and payout receipts in the checked window.</p>'}</div>
      <details class="support-integrations"><summary>Streaming integrations and launch kit</summary><p>Twitch/Kick subscriptions and YouTube donations are not connected. No gift is purchased, queued or promised by this page.</p><button disabled>Automatic gifts · unavailable</button><button id="creator-widget">Download stream overlay</button><button id="creator-kit">Copy creator launch kit</button><p>The overlay is a manual browser-source link to this public page. It does not post alerts or spend funds. Add it to your streaming software yourself.</p></details>`;
    void loadCreatorCoinLogos(generation);
    const history=document.createElement('section');history.className='support-history';
    page.querySelector('.support-integrations').before(history);
    mountReceiptHistory(history,id,c.cluster,()=>generation===routeGeneration);
    $('#creator-follow').onclick=async()=>{const button=$('#creator-follow');button.disabled=true;try{await saveAccountPreference('creators',id,{remove:safeFollowing().includes(id)});window.dispatchEvent(new Event('funded:following'));button.textContent=safeFollowing().includes(id)?'Unfollow':'Follow';}catch(error){setStatus($('#creator-action-status'),error.message);}finally{button.disabled=false;}};
    $('#creator-share').onclick=()=>copy(supportShareText(c,location.origin),$('#creator-action-status'));
    $('#creator-share-card').onclick=()=>downloadCard(c);
    page.querySelectorAll('[data-update-card]').forEach(button=>button.onclick=()=>downloadCard(c,button,{update:button.dataset.updateCard}));
    page.querySelectorAll('[data-receipt-card]').forEach(button=>button.onclick=()=>downloadCard(c,button,{receipt:button.dataset.receiptCard}));
    $('#creator-support-launch').onclick=()=>{ applySupportPreset(c.handle);$('#launch-route-shell [data-open-launch]')?.click(); };
    page.querySelectorAll('[data-share-receipt]').forEach(button=>button.onclick=()=>copy(`Confirmed ${displayCluster(c.cluster)} payout receipt. Not an earnings forecast. https://explorer.solana.com/tx/${button.dataset.shareReceipt}?cluster=${encodeURIComponent(c.cluster)}`,$('#creator-action-status')));
    mountUpcomingAnnouncements(page,c);
    mountCreatorBrief(page,c); mountCreatorContentControls(page,c);
    $('#creator-kit').onclick=()=>copy(`Community launch checklist\n1. Review the named beneficiary and creator authorization.\n2. Explain total fees and token risks.\n3. Share the canonical coin address.\n4. Publish useful updates, not price promises.\n5. Share only confirmed payout receipts.\n${supportShareText(c,location.origin)}`,$('#creator-action-status'));
    $('#creator-widget').onclick=()=>{const url=new URL(`/creator/x/${id}?overlay=1`,location.origin).href;download(`funded-${id}-overlay.html`,'text/html',`<!doctype html><html><meta charset="utf-8"><title>Creator support overlay</title><iframe title="Creator support receipts" src="${esc(url)}" style="width:100%;height:96vh;border:0"></iframe></html>`);setStatus($('#creator-action-status'),'Overlay downloaded. It shows current page data only; no automated posts or gifts.');};
  }catch(error){if(generation===routeGeneration)page.innerHTML=`<h1>Creator page unavailable</h1><p role="status">${esc(error.message)}</p><a href="#creators">Find creators</a>`;}
}
function download(name,type,content){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function downloadCard(c,button=$('#creator-share-card'),selection={}){
  const status=$('#creator-action-status');button.disabled=true;
  try{const response=await fetch(`/api/creators/${c.id}/card.png?${new URLSearchParams(selection)}`,{signal:AbortSignal.timeout(25000)});if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw new Error('Card unavailable. Refresh the page to check creator consent and receipt evidence.');download(`funded-${c.id}-${selection.receipt?'receipt':selection.update?'update':'creator'}-${c.cluster}.png`,'image/png',await response.blob());setStatus(status,'PNG downloaded. Review before sharing; no automatic post was sent.');}
  catch(error){setStatus(status,error.message);}finally{button.disabled=false;}
}

async function renderSettings(generation) {
  page.innerHTML='<h1>My creator page</h1><p role="status">Checking X identity…</p>';
  try {
    const result=await apiRequest('/api/creator-support/me',{signal:AbortSignal.timeout(10000)});
    if(generation!==routeGeneration)return;
    if(!result.available || !result.data?.csrf)throw new Error('Creator management requires the current API and X sign-in.');
    const managed=result.data;const p=managed.profile || {};const id=String(managed.user.id);
    page.innerHTML=`<a href="#creators">← Creators</a><h1>Manage @${esc(managed.user.username)}</h1><p>Only your verified X session can change this page. Listing your profile does not endorse any coin.</p><form id="creator-settings-form"><label class="support-check"><input id="creator-listed" type="checkbox" ${p.listed?'checked':''}>List my creator page publicly</label><label class="support-check"><input id="creator-opt-out" type="checkbox" ${p.optedOut?'checked':''}>Exclude my page and block new support launches</label><p>Exclusion does not erase blockchain records or existing payment entitlements.</p><fieldset><legend>Explicit coin authorization</legend><p>Check only coins you authorize. Unchecked coins remain fan-created, not endorsed.</p>${managed.coins.map(c=>`<label class="support-check"><input type="checkbox" name="authorizedMint" value="${esc(c.mint)}" ${p.authorizedMints?.includes(c.mint)?'checked':''}>${esc(c.name || c.mint)}<small>${esc(c.mint)}</small></label>`).join('')||'<p>No eligible support coins.</p>'}</fieldset><button type="submit">Save my choices</button></form><p id="creator-settings-status" role="status"></p><a href="/creator/x/${id}">View public page</a><h2>Publish a community update</h2><form id="creator-update-form"><label>Update<textarea id="creator-update-text" maxlength="280" rows="4" required placeholder="Share progress, not price promises."></textarea></label><p>Public immediately after publication. Requires an opted-in listed page.</p><button type="submit">Publish update</button></form>`;
    const exclusionState=document.createElement('p');exclusionState.id='creator-exclusion-state';
    const showExclusionState=profile=>{exclusionState.textContent=profile?.updatedAt?`${profile.optedOut?'Exclusion active':'Exclusion off'} · saved ${new Date(profile.updatedAt).toLocaleString()}`:'No exclusion choice saved yet.';};
    showExclusionState(p);page.querySelector('#creator-settings-form').before(exclusionState);
    const status=$('#creator-settings-status'), updateText=$('#creator-update-text');
    $('#creator-settings-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const saved=await apiRequest('/api/creator-support/profile',{method:'POST',headers:{'x-creator-csrf':managed.csrf},body:{listed:$('#creator-listed').checked,optedOut:$('#creator-opt-out').checked,authorizedMints:[...page.querySelectorAll('[name="authorizedMint"]:checked')].map(input=>input.value)}});if(!saved.available)throw new Error('API unavailable. Choices were not saved.');showExclusionState(saved.data);status.textContent='Saved. Existing financial obligations are unchanged.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
    mountAnnouncementSettings(page,managed);
    mountCreatorBriefSettings(page,managed);
  }catch(error){if(generation===routeGeneration)page.innerHTML=`<a class="creator-settings-back" href="#my-launches">← Portfolio</a><header class="workspace-page-header"><p class="eyebrow">Account</p><h1>Your creator profile.</h1><p>Manage your X profile and coin permissions.</p></header><section class="creator-settings-signin" aria-label="Creator account sign-in"><p role="status">${esc(error.message)}</p><ul class="creator-settings-preview" aria-label="What you can manage after signing in"><li>Link your X profile to the coins you launched</li><li>Add a recipient wallet to claim X account rewards</li><li>Post creator updates on your coin pages</li></ul><p class="field-help">Use your X account. Connecting a wallet does not prove X account ownership.</p><div class="creator-settings-actions"><a class="primary-button" href="/api/x/oauth/start">Sign in with X</a><a class="secondary-button" href="#my-launches">Open Portfolio</a></div></section>`;}
}
function syncRoute(){const kind=routeKind();syncSupportShortcutState();routeGeneration++;document.body.classList.toggle('support-view-active',Boolean(kind));document.body.classList.toggle('support-overlay',kind==='creator'&&new URLSearchParams(location.search).get('overlay')==='1');page.hidden=!kind;page.classList.toggle('creator-settings-page',kind==='settings');if(!kind)return;const label=kind==='settings'?'Creator settings':kind==='directory'?'Creators':'Creator support';$('[data-route-label]').textContent=label;$('[data-route-description]').textContent=routeGroup('creators');document.title=`${label} | richpad.fun (${APP_CLUSTER})`;window.scrollTo(0,0);if(kind==='directory')void renderDirectory();else if(kind==='settings')void renderSettings(routeGeneration);else void renderCreator(creatorRoute(),routeGeneration);}
window.addEventListener('hashchange',syncRoute);window.addEventListener('popstate',syncRoute);
syncRoute();
