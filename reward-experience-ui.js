import './reward-experience.css';
import { summarizeXClaims, formatXClaimSol } from './x-claim-summary.js';
import { createTokenCardActions } from './token-card-controls.js';
import { tokenListMarket, tokenAge } from './token-list-market-state.js';
import { devnetImageUri } from './devnet-metadata.js';

const LAMPORTS = 1_000_000_000n;
const ALERT_KEY = 'funded.vip.reward-alerts.v1';
const WATCH_KEY = 'funded.app.community.watchlist';
const byId = id => document.getElementById(id);
const validMint = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
const explorer = signature => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
const tokenUrl = mint => `/token/${encodeURIComponent(mint)}`;
const short = value => `${String(value).slice(0, 5)}…${String(value).slice(-5)}`;
function sol(value) {
  const n = /^(?:0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : 0n;
  const fraction = String(n % LAMPORTS).padStart(9, '0').replace(/0+$/, '');
  return `${n / LAMPORTS}${fraction ? '.' + fraction : ''} SOL`;
}
function decimalLamports(value) {
  const match = String(value ?? '').match(/^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/);
  return match ? BigInt(match[1]) * LAMPORTS + BigInt((match[2] || '').padEnd(9, '0')) : 0n;
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
function alertPrefs() {
  try { const row = JSON.parse(localStorage.getItem(ALERT_KEY) || '{}'); return {
    enabled:row.enabled === true, seen:Array.isArray(row.seen) ? row.seen.slice(-150) : [],
    notices:Array.isArray(row.notices) ? row.notices.slice(-30) : [],
  }; } catch { return { enabled:false, seen:[], notices:[] }; }
}
function saveAlertPrefs(prefs) { localStorage.setItem(ALERT_KEY, JSON.stringify(prefs)); }
function watchedMints() {
  try { return new Set(JSON.parse(localStorage.getItem(WATCH_KEY) || '[]').filter(validMint)); }
  catch { return new Set(); }
}
function createPanels() {
  const payments = byId('payments');
  const rewardsOverview = byId('rewards-overview') || payments;
  if (payments && !byId('reward-portfolio')) {
    const section = node('section', 'reward-experience-panel', null); section.id = 'reward-portfolio';
    section.innerHTML = `<header><div><p class="eyebrow">Your connected wallet</p><h2>Your reward status</h2><p>See SOL received by this wallet and creator fees awaiting payout. X rewards need a matching X sign-in; launched coin tokens are checked in Airdrops.</p></div><div class="reward-portfolio-top-actions"><span data-reward-evidence>Checking evidence…</span><button type="button" data-reward-connect>Connect wallet</button></div></header><div class="reward-portfolio-body" data-reward-portfolio role="status">Connect a wallet to see your reward records.</div><div class="reward-portfolio-destinations"><p class="reward-portfolio-label">Other reward programs</p><nav class="reward-portfolio-links" aria-label="Reward programs"><a href="#airdrops"><span><strong>$FUNDED airdrops</strong><small>Check snapshot and claim status</small></span><b aria-hidden="true">↗</b></a><a href="#referrals"><span><strong>Referral rewards</strong><small>Sign and claim earned SOL</small></span><b aria-hidden="true">↗</b></a><a href="#payments" data-x-reward-link><span><strong>X account rewards</strong><small>Use the matching X sign-in</small></span><b aria-hidden="true">↗</b></a></nav></div><small class="reward-portfolio-note">A published allocation is not your wallet balance. Holder payments are automatic after an eligible snapshot and verified payout.</small>`;
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
    section.innerHTML = `<header><div><p class="eyebrow">Reward programs</p><h2>Explore holder rewards</h2><p>Compare tokens that share fees with holders. Amounts shown are program totals, not rewards available to your wallet.</p></div><label>Show <select data-reward-filter><option value="all">All holder rewards</option><option value="allocated">Rewards set aside</option><option value="paid">Holders paid</option></select></label></header><div data-reward-discovery role="status">Checking verified launches…</div><small>Eligible wallets receive SOL automatically after holdings and funding are confirmed. “0 paid wallets” means no holder payment is confirmed.</small>`;
    (byId('rewards-holder') || rewardsOverview).append(section);
    section.querySelector('[data-reward-filter]').addEventListener('change', () => renderDiscovery(latest));
  }
  const community = byId('community');
  if (community && !byId('community-reward-reserve')) {
    const oldStatus = byId('community-alert-status');
    if (oldStatus) oldStatus.textContent = 'Optional in-app alerts for watched coins are available below.';
    const section = node('section', 'reward-experience-panel', null); section.id = 'community-reward-reserve';
    section.innerHTML = `<header><div><p class="eyebrow">Community fund</p><h2>Funds for future programs</h2><p>A share of collected SOL is set aside for future community programs. No SOL rewards from this fund are available to claim yet.</p></div></header><div data-community-reserve>Checking funds set aside…</div><p class="reward-ideas">Program rules and confirmed payments will appear when a program becomes available.</p>`;
    community.append(section);
    const alerts = node('section', 'reward-experience-panel reward-alerts', null); alerts.id = 'reward-alerts';
    alerts.innerHTML = `<header><div><p class="eyebrow">Followed coins</p><h2>Reward alerts</h2><p>Get an in-app notice when a watched coin has a newly verified fee collection, holder payment, or buyback burn.</p></div><label><input type="checkbox" data-alert-toggle /> Enable</label></header><div data-alert-status role="status">Alerts are off.</div><div data-alert-list></div><small>Alerts work while this page is open and are saved on this device. They do not promise a payout or run in the background.</small>`;
    community.append(alerts);
    const navigateCommunity = (target, focusToggle = false) => {
      const destination = target === 'alerts' ? alerts : community.querySelector('.community-grid');
      if (!destination) return;
      community.querySelectorAll('[data-community-target]').forEach(button => {
        const active = button.dataset.communityTarget === target;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      destination.scrollIntoView({ behavior:'smooth', block:'start' });
      if (focusToggle) alerts.querySelector('[data-alert-toggle]')?.focus({ preventScroll:true });
    };
    community.querySelectorAll('[data-community-target]').forEach(button => button.addEventListener('click', () =>
      navigateCommunity(button.dataset.communityTarget)));
    byId('manage-alerts')?.addEventListener('click', () => navigateCommunity('alerts', true));
    alerts.querySelector('[data-alert-toggle]').checked = alertPrefs().enabled;
    alerts.querySelector('[data-alert-toggle]').addEventListener('change', event => {
      const prefs = alertPrefs(); prefs.enabled = event.target.checked;
      if (prefs.enabled) prefs.seen = (latest?.events || []).map(item => `${item.kind}:${item.signature}`).slice(0, 150);
      saveAlertPrefs(prefs); renderAlerts();
    });
  }
  const buybacks = byId('buybacks');
  if (buybacks && !byId('verified-buyback-flow')) {
    const section = node('section', 'reward-experience-panel', null); section.id = 'verified-buyback-flow';
    section.innerHTML = `<header><div><p class="eyebrow">Fee-funded $FUNDED burn</p><h2>Buyback progress</h2><p>See fees waiting for a buyback and confirmed purchases that permanently remove $FUNDED from supply.</p></div></header><div data-buyback-flow role="status">Checking the Solana buyback queue…</div><small>Launch-tier burns are separate. A buyback does not guarantee a price change.</small>`;
    buybacks.prepend(section);
  }
}

let latest = null;
function renderPortfolio(data, referralData, xData) {
  const body = document.querySelector('[data-reward-portfolio]'); if (!body) return;
  const wallet = data?.wallet;
  byId('reward-portfolio')?.classList.toggle('reward-no-wallet', !wallet);
  const connectButton = byId('reward-portfolio')?.querySelector('[data-reward-connect]');
  if (connectButton) connectButton.hidden = Boolean(wallet);
  body.replaceChildren();
  if (!wallet) {
    const empty = node('div', 'reward-portfolio-empty');
    const copy = node('div', 'reward-portfolio-empty-copy');
    copy.append(node('span', 'reward-portfolio-empty-icon', '◈'), node('h3', '', 'Connect to see your SOL rewards'),
      node('p', '', 'Connect your wallet to check balances and payments.'));
    const button = node('button', 'reward-portfolio-connect', 'Connect wallet');
    button.type = 'button';
    button.addEventListener('click', () => byId('connect-button')?.click());
    empty.append(copy, button);
    body.append(empty);
    return;
  }
  if (data.evidence.status === 'unavailable') { body.textContent = 'We cannot check reward payments right now. Try again shortly to see your totals.'; return; }
  const rows = wallet.rows || [];
  const paid = rows.flatMap(row => row.payouts || []);
  const referralClaims = Array.isArray(referralData?.claims) ? referralData.claims.filter(row => row.asset === 'SOL') : null;
  const referralOpen = referralClaims?.filter(row => row.status !== 'paid' && row.status !== 'expired') || [];
  const xClaims = summarizeXClaims(xData?.claims);
  const legend = node('div', 'reward-status-legend');
  for (const [name, description] of [['Ready to claim', 'Review and claim your reward'], ['Waiting', 'Set aside; payment not confirmed'], ['Received', 'Payment confirmed in your wallet']]) {
    const item = node('span'); item.append(node('strong', '', name), node('small', '', description)); legend.append(item);
  }
  body.append(legend);
  const summary = node('div', 'reward-portfolio-summary');
  const creatorUnpaid = rows.reduce((sum, row) => sum + BigInt(row.creatorWithoutPayoutProofLamports || '0'), 0n);
  const summaryRows = [
    ['Waiting · creator SOL', sol(creatorUnpaid), 'Set aside for you; payment is not confirmed yet', 'creator'],
    ['Received · SOL', sol(paid.reduce((sum, row) => sum + BigInt(row.amountLamports), 0n)), 'Confirmed payments found in your reward history', 'history'],
    ['Referral SOL to review', referralClaims ? sol(referralOpen.reduce((sum, row) => sum + decimalLamports(row.amount), 0n)) : 'Unable to check', 'Connect the wallet that earned these rewards, then review each claim', '#referrals'],
    ['Ready to claim · X SOL', xClaims ? formatXClaimSol(xClaims.unclaimed) : document.querySelector('#x-sign-in')?.dataset.connected === 'true' ? 'Unable to check' : 'Sign in with X', 'Only rewards linked to the signed-in X account', 'x'],
  ];
  for (const [label, value, hint, destination] of summaryRows) {
    const card = node('div'); card.append(node('small','',label), node('strong','',value), node('small','reward-summary-hint',hint));
    const action = destination.startsWith('#') ? link('Review →', destination) : node('button', 'reward-summary-action', 'Review →');
    if (destination !== '#referrals') { action.type = 'button'; action.addEventListener('click', () => byId(`rewards-${destination}-tab`)?.click()); }
    card.append(action); summary.append(card);
  }
  body.append(summary);
  const tokenNote = node('p', 'reward-token-claim-note');
  tokenNote.append(node('strong', '', 'Token airdrops: '), document.createTextNode('check whether you qualify, how much you can claim, and past claims in '), link('Airdrops →', '#airdrops'));
  body.append(tokenNote);
  if (!rows.length) { body.append(node('p','reward-empty','No confirmed creator or holder payments were found for this wallet. Each reward program has its own eligibility requirements.')); return; }
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
}
function renderDiscovery(data) {
  const root = document.querySelector('[data-reward-discovery]'); if (!root) return;
  root.replaceChildren();
  if (data?.evidence.status === 'unavailable') { root.textContent = 'Reward programs are unavailable right now. Try again shortly.'; return; }
  const filter = document.querySelector('[data-reward-filter]')?.value || 'all';
  const tokens = (data?.tokens || []).filter(row => row.holderSharePercent > 0 &&
    (filter === 'all' || filter === 'allocated' && BigInt(row.totals.holder) > 0n || filter === 'paid' && row.holderPaidWallets > 0));
  if (!tokens.length) { root.textContent = data ? 'No tokens match this reward filter yet.' : 'Reward programs are unavailable right now.'; return; }
  const list = node('div', 'reward-discovery-list');
  for (const row of tokens.slice(0, 30)) {
    const article = node('article');
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
    info.append(link(`${row.symbol || short(row.mint)} · ${row.name}`, tokenUrl(row.mint)));
    const market = tokenListMarket(row.mint);
    const age = tokenAge(market?.createdTimestamp || row.createdAt);
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
    title.append(node('span','',row.status === 'holders-paid' ? 'Holders paid' : row.status === 'holder-fees-allocated' ? 'Rewards set aside' : 'Rewards announced'));
    article.append(title);
    article.append(node('p','',`${row.holderSharePercent}% fee share · ${sol(row.totals.holder)} set aside · ${row.holderPaidWallets} paid wallet${row.holderPaidWallets === 1 ? '' : 's'}`));
    if (row.lastHolderPayout) article.append(node('small','',`Latest recorded holder payment ${new Date(row.lastHolderPayout).toLocaleString()}`));
    if (validMint(row.mint)) article.append(createTokenCardActions({ mint: row.mint, symbol: row.symbol, name: row.name, className: 'reward-token-actions' }));
    list.append(article);
  }
  root.append(list);
}
function renderCommunity(data) {
  const root = document.querySelector('[data-community-reserve]'); if (!root) return;
  root.replaceChildren();
  if (!data || data.evidence.status === 'unavailable') { root.textContent = 'Community fund totals are unavailable right now.'; return; }
  const block = node('div','reward-community-total'); block.append(node('strong','',sol(data.community.allocatedLamports)),
    node('span','','set aside from confirmed token fees'));
  root.append(block);
  if (data.community.baseAllocatedLamports != null && data.community.referralRolloverLamports != null) {
    root.append(node('p','',`${sol(data.community.baseAllocatedLamports)} community share · ${sol(data.community.referralRolloverLamports)} from unused referral shares`));
  }
  if (data.community.fundedLamports != null && BigInt(data.community.fundedLamports) > 0n) {
    root.append(node('p','',`${sol(data.community.fundedLamports)} transferred to the community fund account in confirmed transactions.`));
    if (data.community.vaultAddress) root.append(link(`Fund account ${short(data.community.vaultAddress)} ↗`, explorer(data.community.vaultAddress), true));
  } else root.append(node('p','', 'These funds are set aside, but a transfer to the community fund account has not been confirmed.'));
  root.append(node('p','', 'No community SOL payments are available yet. Transfers shown here do not confirm the current balance or future spending.'));
}
function renderBuybacks(data) {
  const root = document.querySelector('[data-buyback-flow]'); if (!root) return;
  root.replaceChildren();
  if (!data) { root.textContent = 'Buyback status is unavailable.'; return; }
  const pending = (data.pending || []).filter(row => BigInt(row.pendingLamports || '0') > 0n);
  const receipts = (data.receipts || []).filter(row => row.status === 'finalized' && row.refundVerified === true);
  const stats = node('div','reward-buyback-stats');
  for (const [label,value] of [['Queued funds',sol(pending.reduce((sum,row) => sum + BigInt(row.pendingLamports), 0n))],
    ['Completed buybacks',String(receipts.length)]]) { const item = node('div'); item.append(node('small','',label),node('strong','',value)); stats.append(item); }
  root.append(stats);
  const list = node('div','reward-buyback-list');
  for (const row of pending.slice(0, 8)) {
    const article = node('p'); article.append(link(short(row.mint), tokenUrl(row.mint)),
      node('span','',` · ${sol(row.pendingLamports)} queued · ${row.activeOrder ? 'in progress' : row.eligible ? 'ready for the next batch' : 'building up funds'}`));
    list.append(article);
  }
  for (const row of receipts.slice(0, 8)) {
    const article = node('p'); article.append(link(short(row.mint), tokenUrl(row.mint)),
      node('span','',` · ${row.boughtAndBurnedBaseUnits || row.burnedBaseUnits} $FUNDED base units burned · `),
      link('Proof ↗', explorer(row.signature), true)); list.append(article);
  }
  if (!list.children.length) list.append(node('p','reward-empty','No token buybacks are waiting, and no completed burns are available to show.'));
  root.append(list);
}
function renderAlerts() {
  const prefs = alertPrefs(); const status = document.querySelector('[data-alert-status]');
  const list = document.querySelector('[data-alert-list]'); if (!status || !list) return;
  status.textContent = prefs.enabled ? `Watching ${watchedMints().size} saved coin${watchedMints().size === 1 ? '' : 's'} while this page is open.` : 'Alerts are off.';
  list.replaceChildren();
  for (const notice of prefs.notices.slice(-10).reverse()) {
    const article = node('p'); article.append(link(short(notice.mint), tokenUrl(notice.mint)),
      node('span','',` · ${notice.label} · `), link('Proof ↗', explorer(notice.signature), true)); list.append(article);
  }
  if (!list.children.length) list.append(node('p','reward-empty',prefs.enabled ? 'No new reward activity from your saved tokens.' : 'Turn on alerts to see new reward activity from saved tokens.'));
  const dialog = byId('notification-dialog');
  const feed = dialog?.querySelector('.notice-list');
  if (feed && prefs.enabled && prefs.notices.length) {
    feed.replaceChildren();
    for (const notice of prefs.notices.slice(-10).reverse()) {
      const article = node('div'); article.append(node('strong','',notice.label), link(`${short(notice.mint)} · transaction ↗`, explorer(notice.signature), true)); feed.append(article);
    }
    const title = dialog.querySelector('h2'); if (title) title.textContent = 'Watched reward events';
  } else if (feed && dialog?.querySelector('h2')?.textContent === 'Watched reward events') {
    feed.replaceChildren(node('p','', 'No active watched reward notices.'));
    dialog.querySelector('h2').textContent = 'No verified notifications';
  }
}
function captureAlerts(data) {
  const prefs = alertPrefs(); if (!prefs.enabled || !data || data.evidence.status === 'unavailable') return;
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
async function fetchJson(path) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`Status ${response.status}`);
  return response.json();
}
let refreshToken = 0;
async function refresh() {
  const current = ++refreshToken;
  const wallet = document.documentElement.dataset.connectedWallet || '';
  const mint = location.pathname.match(/^\/token\/([^/]+)$/)?.[1] || '';
  const params = new URLSearchParams();
  if (validMint(wallet)) params.set('wallet', wallet);
  if (validMint(mint)) params.set('mint', mint);
  const scoped = validMint(mint);
  const xConnected = document.querySelector('#x-sign-in')?.dataset.connected === 'true';
  const [experience, buybacks, referrals, xClaims] = await Promise.allSettled([
    fetchJson(`/api/rewards/experience${params.size ? '?' + params : ''}`),
    fetchJson('/api/buyback/status'),
    validMint(wallet) ? fetchJson(`/api/referral-claims?wallet=${encodeURIComponent(wallet)}`) : Promise.resolve(null),
    xConnected ? fetchJson('/api/x-fee/claims') : Promise.resolve(null),
  ]);
  if (current !== refreshToken) return;
  latest = experience.status === 'fulfilled' ? experience.value : null;
  document.querySelectorAll('[data-reward-evidence]').forEach(element => { element.textContent = latest?.evidence?.status === 'onchain-indexed' ? 'Payments checked' : latest?.evidence?.status === 'partial' ? 'Some payment history is missing' : latest?.evidence?.status === 'no-records' ? 'No confirmed payments yet' : 'Unable to check payments'; });
  renderPortfolio(latest, referrals.status === 'fulfilled' ? referrals.value : null, xClaims.status === 'fulfilled' ? xClaims.value : null);
  renderDiscovery(scoped ? null : latest);
  renderCommunity(scoped ? null : latest);
  renderBuybacks(buybacks.status === 'fulfilled' ? buybacks.value : null);
  if (!scoped) captureAlerts(latest);
}

createPanels();
renderAlerts();
document.addEventListener('funded:token-list-markets', () => {
  if (!location.pathname.startsWith('/token/')) renderDiscovery(latest);
});
window.addEventListener('funded:reward-identity-change', refresh);
window.addEventListener('popstate', refresh);
window.addEventListener('hashchange', () => { if (!document.hidden) void refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
void refresh();
