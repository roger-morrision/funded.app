import { publicReadFetch as fetch } from './src/lib/public-read-fetch.js';
import {accountFavorites} from './src/features/account/preferences.js';
import { renderHolderAirdropDirectory } from './src/features/rewards/holder-airdrop-directory.js';
import './reward-experience.css';
import { paginateHistory } from './history-pagination.js';
import { createTokenCardActions } from './token-card-controls.js';
import { tokenListMarket, tokenAge } from './token-list-market-state.js';
import { devnetImageUri } from './devnet-metadata.js';
import { newestBuybackReceipts } from './src/features/funded/buyback-receipts.js';
import { formatTokenBaseUnits } from './funded-burn.js';
import { burnTimestamp } from './src/features/funded/burn-history-table.js';

const LAMPORTS = 1_000_000_000n;
const ALERT_KEY = 'funded.vip.reward-alerts.v1';
const WATCH_KEY = 'funded.app.community.watchlist';
const byId = id => document.getElementById(id);
const validMint = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
const explorer = signature => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
const tokenUrl = mint => `/token/${encodeURIComponent(mint)}`;
const short = value => `${String(value).slice(0, 5)}…${String(value).slice(-5)}`;
function sol(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value))) return '-';
  const n = BigInt(value);
  const fraction = String(n % LAMPORTS).padStart(9, '0').replace(/0+$/, '');
  return `${n / LAMPORTS}${fraction ? '.' + fraction : ''} SOL`;
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function link(label, href, external = false) {
  const a = node('a', '', label); a.href = href;
  if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  return a;
}
let lastAlertPrefs = { seen: [], notices: [] };
let alertStorageUnavailable = false;
function alertPrefs() {
  if (alertStorageUnavailable) return lastAlertPrefs;
  try { const row = JSON.parse(localStorage.getItem(ALERT_KEY) || '{}'); return {
    seen:Array.isArray(row.seen) ? row.seen.slice(-150) : [],
    notices:Array.isArray(row.notices) ? row.notices.slice(-30) : [],
  }; } catch { return lastAlertPrefs; }
}
function saveAlertPrefs(prefs) {
  lastAlertPrefs = prefs;
  try { localStorage.setItem(ALERT_KEY, JSON.stringify(prefs)); } catch { alertStorageUnavailable = true; }
}
function watchedMints() { return new Set(accountFavorites()); }
function createPanels() {
  const payments = byId('payments');
  const rewardsOverview = byId('rewards-overview') || payments;
  if (payments && !byId('reward-portfolio')) {
    const section = node('section', 'reward-experience-panel', null); section.id = 'reward-portfolio';
    section.innerHTML = `<header><div><p class="eyebrow">Your connected wallet</p><h2>Recent SOL receipts</h2><p>Recorded payments and creator rewards for your connected wallet.</p></div><div class="reward-portfolio-top-actions"><span data-reward-evidence>Checking evidence…</span><button type="button" data-reward-connect>Connect wallet</button></div></header><div class="reward-portfolio-body" data-reward-portfolio role="status">Connect a wallet to see your reward records.</div><div class="reward-portfolio-destinations"><p class="reward-portfolio-label">Other reward programs</p><nav class="reward-portfolio-links" aria-label="Reward programs"><a href="#airdrops"><span><strong>$FUNDED airdrops</strong><small>View automatic delivery</small></span><b aria-hidden="true">↗</b></a><a href="#referrals"><span><strong>Referral rewards</strong><small>Sign in to view paid SOL</small></span><b aria-hidden="true">↗</b></a><a href="#payments" data-x-reward-link><span><strong>X account rewards</strong><small>Use the matching X sign-in</small></span><b aria-hidden="true">↗</b></a></nav></div><small class="reward-portfolio-note">A published allocation is not your wallet balance. Holder payments are automatic after an eligible snapshot and verified payout.</small>`;
    const publicHistory = payments.querySelector('.x-claim-activity');
    if (publicHistory && rewardsOverview === payments) payments.insertBefore(section, publicHistory);
    else rewardsOverview.prepend(section);
    section.querySelector('[data-x-reward-link]')?.addEventListener('click', event => {
      const tab = byId('rewards-x-tab');
      if (!tab) return;
      event.preventDefault();
      tab.click();
    });
  }
  if (payments && !byId('reward-discovery')) {
    const section = node('section', 'reward-experience-panel reward-discovery', null); section.id = 'reward-discovery';
    section.innerHTML = `<header><div><p class="eyebrow">Reward programs</p><h2>Explore holder rewards</h2><p>Discover tokens that share fees with holders. Amounts shown are program totals, not rewards available to your wallet.</p></div><label>Show <select data-reward-filter><option value="all">All holder rewards</option><option value="allocated">Rewards set aside</option><option value="paid">Holders paid</option></select></label></header><div data-reward-discovery role="status">Checking verified launches…</div><small>Eligible wallets receive SOL automatically after holdings and funding are confirmed. “0 paid wallets” means no holder payment is confirmed.</small>`;
    (byId('rewards-holder') || rewardsOverview).append(section);
    section.querySelector('[data-reward-filter]').addEventListener('change', () => renderDiscovery(latest));
  }
  const buybacks = byId('buybacks');
  if (buybacks && !byId('verified-buyback-flow')) {
    const section = node('section', 'reward-experience-panel', null); section.id = 'verified-buyback-flow';
    section.innerHTML = `<header><div><p class="eyebrow">Fee-funded $FUNDED burn</p><h2>Buyback progress</h2><p>See fees waiting for a buyback and confirmed purchases that permanently remove $FUNDED from supply.</p></div></header><div data-buyback-flow role="status">Checking the Solana buyback queue…</div><small>Launch-tier burns are separate. A buyback does not guarantee a price change.</small>`;
    buybacks.prepend(section);
  }
}

let latest = null;
function renderPortfolio(data) {
  const body = document.querySelector('[data-reward-portfolio]'); if (!body) return;
  const wallet = data?.wallet;
  const focused=body.contains(document.activeElement)||document.activeElement===byId('reward-portfolio')?.querySelector('[data-reward-connect]');
  byId('reward-portfolio')?.classList.toggle('reward-no-wallet', !wallet);
  if(byId('reward-portfolio'))byId('reward-portfolio').hidden=!wallet;
  const connectButton = byId('reward-portfolio')?.querySelector('[data-reward-connect]');
  if (connectButton) connectButton.hidden = Boolean(wallet);
  if(!wallet&&body.querySelector('.reward-portfolio-empty'))return;
  body.replaceChildren();
  if (!wallet) {
    const empty = node('div', 'reward-portfolio-empty');
    const copy = node('div', 'reward-portfolio-empty-copy');
    copy.append(node('span', 'reward-portfolio-empty-icon', '◈'), node('h3', '', 'Connect to see your SOL rewards'),
      node('p', '', 'View recorded SOL rewards and payout history.'));
    const button = node('button', 'reward-portfolio-connect', 'Connect wallet');
    button.type = 'button';
    button.addEventListener('click', () => byId('connect-button')?.click());
    empty.append(copy, button);
    body.append(empty);
    if(focused)button.focus({preventScroll:true});
    return;
  }
  if (data.evidence.status === 'unavailable') { body.textContent = '-'; return; }
  const rows = wallet.rows || [];
  const paid = rows.flatMap(row => row.payouts || []);
  const tokenNote = node('p', 'reward-token-claim-note');
  tokenNote.append(node('strong', '', 'Token airdrops: '), document.createTextNode('automatic at migration, based on eligible $FUNDED holdings. '), link('View airdrops →', '#airdrops'));
  body.append(tokenNote);
  if (!rows.length) return;
  const historyHeading = node('div', 'reward-history-heading');
  historyHeading.append(node('h3', '', 'Payment history'), node('span', '', `${paid.length} confirmed payment${paid.length === 1 ? '' : 's'}`));
  body.append(historyHeading);
  const list = node('div', 'reward-portfolio-list');
  for (const row of rows.filter(row => BigInt(row.creatorWithoutPayoutProofLamports || '0') > 0n || row.payouts?.length)) {
    const article = node('article', 'reward-history-card');
    const heading = node('div','reward-row-head'); heading.append(link(row.symbol || short(row.mint), tokenUrl(row.mint)));
    heading.append(node('span','',row.creator ? 'Creator' : row.payouts.some(item => item.kind === 'holder') ? 'Holder' : 'Reward recipient'));
    article.append(heading);
    if (row.creator && BigInt(row.creatorWithoutPayoutProofLamports || '0') > 0n) article.append(node('p','reward-history-pending',`${sol(row.creatorWithoutPayoutProofLamports)} allocated · awaiting payment`));
    for (const payment of row.payouts) {
      const line = node('div', 'reward-history-payment');
      const identity = node('div', 'reward-history-identity');
      const kind = payment.kind === 'creator' ? 'Creator fee' : payment.kind === 'holder' ? 'Holder reward' : payment.kind === 'x' ? 'X account reward' : 'Referral reward';
      identity.append(node('strong', '', kind));
      const recipient = node('small', 'reward-history-recipient', `To ${short(payment.wallet || wallet.address)}`);
      recipient.title = payment.wallet || wallet.address;
      identity.append(recipient);
      const paidAt = payment.paidAt ? new Date(payment.paidAt) : null;
      if (paidAt && !Number.isNaN(paidAt.getTime())) identity.append(node('small', 'reward-history-time', `Paid ${paidAt.toLocaleString()}`));
      if (payment.feeSourceVerified && payment.sourceClaims?.length) identity.append(node('small', 'reward-history-source', 'Paid from collected fees'));
      const actions = node('div', 'reward-history-actions');
      const amount = node('span', 'reward-history-amount');
      amount.append(node('strong', '', sol(payment.amountLamports)), node('small', '', 'Received'));
      const proof = link('↗', explorer(payment.signature), true);
      proof.className = 'payment-receipt-link';
      proof.title = 'View payment on Solana Explorer';
      proof.setAttribute('aria-label', `View ${kind.toLowerCase()} payment on Solana Explorer`);
      actions.append(amount, proof);
      line.append(identity, actions);
      article.append(line);
    }
    if (validMint(row.mint)) article.append(createTokenCardActions({ mint: row.mint, symbol: row.symbol, name: row.name, className: 'reward-token-actions' }));
    list.append(article);
  }
  body.append(list);
  paginateHistory(list, {label:'Reward history', selector:':scope > article'});
}
function renderDiscovery(data) {
  renderHolderAirdropDirectory(data);
  const root = document.querySelector('[data-reward-discovery]'); if (!root) return;
  root.replaceChildren();
  if (data?.evidence.status === 'unavailable') { root.textContent = 'Reward programs are unavailable right now. Try again shortly.'; return; }
  const filter = document.querySelector('[data-reward-filter]')?.value || 'all';
  const tokens = (data?.tokens || []).filter(row => row.holderSharePercent > 0 &&
    (filter === 'all' || filter === 'allocated' && BigInt(row.totals.holder) > 0n || filter === 'paid' && row.holderPaidWallets > 0));
  if (!tokens.length) { root.textContent = data ? 'No tokens match this reward filter yet.' : 'Reward programs are unavailable right now.'; return; }
  const list = node('div', 'reward-discovery-list');
  for (const row of tokens.slice(0, 30)) {
    const article = node('article', 'token-card-shell reward-discovery-card');
    const title = node('div','reward-row-head');
    const identity = node('div','reward-token-identity');
    const avatar = node('span', 'reward-token-avatar', String(row.symbol || row.name || '?').slice(0, 2));
    avatar.setAttribute('aria-hidden', 'true');
    const logo = node('img'); logo.src = `/devnet-images/${encodeURIComponent(row.mint)}`;
    logo.alt = ''; logo.loading = 'lazy';
    let triedFallback = false;
    logo.addEventListener('error', () => {
      if (!triedFallback) { triedFallback = true; logo.src = devnetImageUri(row.mint); }
      else logo.remove();
    });
    avatar.append(logo);
    const info = node('div', 'reward-token-info');
    const tokenLink = link('', tokenUrl(row.mint));
    tokenLink.append(node('strong', '', row.symbol || short(row.mint)), node('small', '', row.name || 'Unnamed token'));
    info.append(tokenLink);
    const market = tokenListMarket(row.mint);
    const age = tokenAge(row.createdTimestamp || market?.createdTimestamp || row.createdAt);
    const metadata = node('div', 'reward-token-metadata');
    const ageField = node('span', '', 'Age ');
    const time = node('time', '', age.label);
    if (age.timestamp) { time.dateTime = age.timestamp; time.title = `Launched ${new Date(age.timestamp).toLocaleString()}`; }
    ageField.append(time);
    const cap = node('span', '', 'MC ');
    cap.title = 'Market capitalization';
    cap.append(node('strong', '', market?.marketCap || 'Unavailable'));
    metadata.append(ageField, cap);
    info.append(metadata);
    identity.append(avatar, info);
    title.append(identity);
    title.append(node('span',`reward-program-status ${row.status === 'holders-paid' ? 'is-paid' : 'is-pending'}`,row.status === 'holders-paid' ? 'Holders paid' : row.status === 'holder-fees-allocated' ? 'Rewards set aside' : 'Rewards announced'));
    article.append(title);
    article.append(node('p','',`${row.holderSharePercent}% fee share · ${sol(row.totals.holder)} set aside · ${row.holderPaidWallets} paid wallet${row.holderPaidWallets === 1 ? '' : 's'}`));
    if (row.lastHolderPayout) article.append(node('small','',`Latest recorded holder payment ${new Date(row.lastHolderPayout).toLocaleString()}`));
    if (validMint(row.mint)) article.append(createTokenCardActions({ mint: row.mint, symbol: row.symbol, name: row.name, className: 'reward-token-actions' }));
    list.append(article);
  }
  root.append(list);
}
function renderBuybacks(data) {
  const root = document.querySelector('[data-buyback-flow]'); if (!root) return;
  const disclosure = root.querySelector(':scope > .concise-buyback-queue');
  if (disclosure) root.dataset.buybackExpanded = String(disclosure.open);
  root.replaceChildren();
  if (!data) { root.textContent = 'Buyback status is unavailable.'; return; }
  const amount = value => /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : 0n;
  const pending = (data.pending || []).filter(row => amount(row.amountLamports) > 0n);
  const receipts = newestBuybackReceipts((data.receipts || []).filter(row => row.status === 'finalized'
    && row.vaultDebitVerified === true && row.burnInstructionVerified === true));
  const stats = node('div','reward-buyback-stats');
  for (const [label,value] of [['Recorded unspent allocations',sol(pending.reduce((sum,row) => sum + amount(row.amountLamports), 0n))],
    ['Recorded buybacks',String(receipts.length)]]) { const item = node('div'); item.append(node('small','',label),node('strong','',value)); stats.append(item); }
  root.append(stats);
  root.append(node('p','reward-source-note',data.dashboard?.status==='verified'
    ? 'Recorded receipts and allocations are shown below. Current eligible vault funds are verified in the trigger panel above.'
    : 'Current vault balances and automatic execution readiness could not be verified. Any receipts below are recorded history.'));
  const trigger = amount(data.dashboard?.thresholdLamports) > 0n
    ? sol(data.dashboard.thresholdLamports) : null;
  const minimum = amount(data.minimumOrderLamports) > 0n ? sol(data.minimumOrderLamports) : null;
  const list = node('div','reward-buyback-list data-table-scroll');list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label','Buyback queue and receipts, scroll horizontally for all columns');
  const table=node('table','record-table');table.append(node('caption','','Recent buyback allocations and executions'));
  const headings=table.createTHead().insertRow();
  for(const label of ['Project','Activity','Amount','Status / timing','Transaction']){const th=node('th','',label);th.scope='col';headings.append(th);}
  const tbody=table.createTBody();list.append(table);
  const addRow=(row,activity,value,status,signature)=>{
    const tr=tbody.insertRow();tr.insertCell().append(link(short(row.mint),tokenUrl(row.mint)));
    tr.insertCell().textContent=activity;const amount=tr.insertCell();amount.className='numeric';amount.textContent=value;
    tr.insertCell().textContent=status;const proof=tr.insertCell();
    if(signature){const a=link('View receipt ↗',explorer(signature),true);a.className='receipt-link';proof.append(a);}else proof.textContent='—';
  };
  for (const row of pending.slice(0, 8)) {
    addRow(row,'Allocation',sol(row.amountLamports),row.status==='below-minimum-order'
        ? `below ${minimum ? minimum+' order minimum' : 'execution minimum'}; retained in its vault`
        : ['queued','verification-pending'].includes(row.status)
        ? 'in progress' : data.dashboard?.triggerReached ? 'ready for the next batch'
          : trigger ? `Awaiting ${trigger} trigger` : 'Awaiting verified trigger',null);
  }
  for (const row of receipts.slice(0, 8)) {
    const at=burnTimestamp(row);
    addRow(row,'Buy & burn',`${formatTokenBaseUnits(row.boughtAndBurnedBaseUnits||row.burnedBaseUnits,Number(row.tokenDecimals??6),6)} $FUNDED`,at?`${at.slice(0,19).replace('T',' ')} UTC`:'Finalized · time unavailable',row.signature);
  }
  if (!tbody.children.length) {list.replaceChildren(node('p','reward-empty','No token buybacks are waiting, and no completed burns are available to show.'));list.removeAttribute('tabindex');}
  root.append(list);
}
function alertsEnabled() {
  return validMint(document.documentElement.dataset.connectedWallet)
    || document.querySelector('#x-sign-in')?.dataset.connected === 'true';
}
function renderAlerts() {
  const dialog = byId('notification-dialog');
  const feed = dialog?.querySelector('.notice-list');
  if (!feed) return;
  const watched = watchedMints();
  const notices = alertsEnabled() ? alertPrefs().notices.filter(row => watched.has(row.mint)).slice(-10).reverse() : [];
  feed.replaceChildren();
  const title = dialog.querySelector('h2');
  if (title) title.textContent = 'Reward notifications';
  for (const notice of notices) {
    const article = node('div');
    article.append(node('strong', '', notice.label), link(`${short(notice.mint)} · transaction ↗`, explorer(notice.signature), true));
    feed.append(article);
  }
  if (!notices.length) feed.append(node('p', '', alertsEnabled()
    ? 'No new reward activity for your favorite tokens.'
    : 'Sign in to receive reward notifications.'));
}
function captureAlerts(data) {
  const prefs = alertPrefs(); if (!alertsEnabled() || !data || data.evidence?.status === 'unavailable') return;
  const watched = watchedMints(); const seen = new Set(prefs.seen);
  const activeKinds = new Set(['holder-paid', 'buyback-burned']);
  const dailyNotices = new Set(prefs.notices.map(row => `${row.mint}:${row.kind}:${String(row.at || '').slice(0, 10)}`));
  for (const event of (data.events || [])) {
    const key = `${event.kind}:${event.signature}`;
    if (!watched.has(event.mint) || seen.has(key)) continue;
    seen.add(key);
    if (!activeKinds.has(event.kind) || event.kind === 'holder-paid' && event.feeSourceVerified !== true) continue;
    const dayKey = `${event.mint}:${event.kind}:${String(event.at || '').slice(0, 10)}`;
    if (!event.at || dailyNotices.has(dayKey)) continue;
    dailyNotices.add(dayKey);
    prefs.notices.push({ mint:event.mint, signature:event.signature, label:event.label, kind:event.kind, at:event.at });
  }
  prefs.seen = [...seen].slice(-150); prefs.notices = prefs.notices.slice(-30);
  saveAlertPrefs(prefs); renderAlerts();
}
async function fetchJson(path, timeoutMs = 18000) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    // Consume the bounded error response before leaving the fetch, including
    // when a history navigation restores this document. Keep its status an error.
    await response.arrayBuffer().catch(() => {});
    throw new Error(`Status ${response.status}`);
  }
  return response.json();
}
let refreshToken = 0;
let lastRefreshKey = '';
let lastRefreshAt = 0;
async function refresh({ force = false } = {}) {
  renderAlerts();
  const wallet = document.documentElement.dataset.connectedWallet || '';
  const mint = location.pathname.match(/^\/token\/([^/]+)$/)?.[1] || '';
  const xConnected = document.querySelector('#x-sign-in')?.dataset.connected === 'true';
  const refreshKey = JSON.stringify([wallet, mint, xConnected, alertsEnabled()]);
  if (!force && refreshKey === lastRefreshKey && Date.now() - lastRefreshAt < 15_000) return;
  lastRefreshKey = refreshKey;
  lastRefreshAt = Date.now();
  const current = ++refreshToken;
  const params = new URLSearchParams();
  if (validMint(wallet)) params.set('wallet', wallet);
  if (validMint(mint)) params.set('mint', mint);
  const scoped = validMint(mint);
  const [experience, buybacks, alertEvents] = await Promise.allSettled([
    fetchJson(`/api/rewards/experience${params.size ? '?' + params : ''}`),
    fetchJson('/api/buyback/status', 30_000),
    scoped && alertsEnabled() ? fetchJson('/api/rewards/experience') : Promise.resolve(null),
  ]);
  if (current !== refreshToken) return;
  latest = experience.status === 'fulfilled' ? experience.value : null;
  if (!scoped) window.dispatchEvent(new CustomEvent('funded:financial-experience', {detail:latest}));
  document.querySelectorAll('[data-reward-evidence]').forEach(element => { element.textContent = ''; element.hidden = true; });
  renderPortfolio(latest);
  renderDiscovery(scoped ? null : latest);
  renderBuybacks(buybacks.status === 'fulfilled' ? buybacks.value : null);
  captureAlerts(scoped ? (alertEvents.status === 'fulfilled' ? alertEvents.value : null) : latest);
}

createPanels();
renderAlerts();
document.addEventListener('funded:token-list-markets', () => {
  if (!location.pathname.startsWith('/token/')) renderDiscovery(latest);
});
window.addEventListener('funded:reward-identity-change', () => { void refresh({ force:true }); });
window.addEventListener('popstate', () => { void refresh(); });
window.addEventListener('funded:watchlist-changed', () => { renderAlerts(); captureAlerts(latest); });
window.addEventListener('storage', event => {
  if (event.key === WATCH_KEY || event.key === ALERT_KEY || event.key === null) renderAlerts();
});
window.addEventListener('hashchange', () => { if (!document.hidden) void refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
void refresh();
