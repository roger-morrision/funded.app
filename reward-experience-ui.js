import './reward-experience.css';
import { summarizeXClaims, formatXClaimSol } from './x-claim-summary.js';

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
    section.innerHTML = `<header><div><p class="eyebrow">Your wallet · verified records</p><h2>Your reward activity</h2><p>Track collected fees, open claims, and confirmed payments.</p></div><span data-reward-evidence>Checking evidence…</span></header><div class="reward-stage-key"><span>Published</span><span>Collected</span><span>Allocated</span><span>Available</span><span>Paid</span></div><div class="reward-portfolio-body" data-reward-portfolio role="status">Connect a wallet to see your reward records.</div><nav class="reward-portfolio-links"><a href="#airdrops">$FUNDED holder airdrops →</a><a href="#referrals">Referral claims →</a><a href="#payments">X account claims ↓</a></nav><small>Unpaid allocations are not wallet balances. X rewards require the matching X sign-in; airdrop eligibility requires a finalized migration snapshot.</small>`;
    rewardsOverview.append(section);
  }
  if (payments && !byId('reward-discovery')) {
    const section = node('section', 'reward-experience-panel reward-discovery', null); section.id = 'reward-discovery';
    section.innerHTML = `<header><div><p class="eyebrow">Verified benefits</p><h2>Coins rewarding holders</h2><p>Browse published policies and actual payout records separately.</p></div><label>Show <select data-reward-filter><option value="all">All holder policies</option><option value="allocated">Fees allocated</option><option value="paid">Holders paid</option></select></label></header><div data-reward-discovery role="status">Checking verified launches…</div><small>Amounts use the available finalized receipt window, not a lifetime total. Order uses distinct paid wallets, then latest payment; wallets are not people.</small>`;
    rewardsOverview.append(section);
    section.querySelector('[data-reward-filter]').addEventListener('change', () => renderDiscovery(latest));
  }
  const fee = byId('coin-fee-dashboard')?.closest('.coin-fee-dashboard');
  if (fee && !byId('token-reward-proof')) {
    const section = node('section', 'reward-experience-panel token-reward-proof', null); section.id = 'token-reward-proof';
    section.innerHTML = `<header><div><p class="eyebrow">Public proof</p><h2>Where this coin’s fees went</h2><p>Collection, allocation, payments, and buybacks have separate evidence.</p></div><button type="button" data-copy-proof>Copy proof link</button></header><div data-token-proof role="status">Open a verified token to inspect its reward history.</div>`;
    fee.after(section);
    section.querySelector('[data-copy-proof]').addEventListener('click', async event => {
      const mint = location.pathname.match(/^\/token\/([^/]+)$/)?.[1];
      if (!validMint(mint)) return;
      try { await navigator.clipboard.writeText(new URL(tokenUrl(mint), location.origin).href); event.currentTarget.textContent = 'Link copied'; }
      catch { event.currentTarget.textContent = 'Copy unavailable'; }
      setTimeout(() => { if (event.currentTarget.isConnected) event.currentTarget.textContent = 'Copy proof link'; }, 2500);
    });
  }
  const launch = document.querySelector('#launch-form [data-launch-step="2"]');
  if (launch && !byId('creator-reward-studio')) {
    const section = node('section', 'reward-experience-panel reward-studio', null); section.id = 'creator-reward-studio';
    section.innerHTML = `<header><div><p class="eyebrow">Creator planning</p><h2>Choose who benefits</h2><p>Compare the fixed 80% creator-directed share before signing. Examples use 1 SOL of creator fees actually collected.</p></div></header><div class="reward-studio-grid"><article><strong>Creator first</strong><span>0.8 SOL creator · 0 holders · 0 X</span><button type="button" data-studio-preset="creator">Use split</button></article><article><strong>Shared with holders</strong><span>0.6 SOL creator · 0.2 SOL holders</span><button type="button" data-studio-preset="holders">Use split</button></article><article><strong>Creator, holders &amp; X</strong><span>0.5 SOL creator · 0.2 SOL holders · 0.1 SOL X</span><small>Requires a verified X recipient.</small><button type="button" data-studio-preset="partner">Use split</button></article></div><p data-studio-status role="status">The remaining 20% follows the published protocol allocation. These examples are not projected earnings.</p>`;
    launch.prepend(section);
    section.addEventListener('click', event => {
      const choice = event.target.closest('[data-studio-preset]')?.dataset.studioPreset;
      if (!choice) return;
      const presets = { creator:[80,0,0], holders:[60,20,0], partner:[50,20,10] };
      const values = presets[choice];
      if (choice === 'partner' && byId('x-share')?.disabled) {
        section.querySelector('[data-studio-status]').textContent = 'X routing is currently unavailable. Choose another split or check the X service status.';
        return;
      }
      byId('launch-mode-custom')?.click();
      for (const [id, value] of [['creator-wallet-share',values[0]], ['holder-airdrop-share',values[1]], ['x-share',values[2]]]) {
        const input = byId(id); if (!input) continue; input.value = String(value); input.dispatchEvent(new Event('input', { bubbles:true }));
      }
      section.querySelector('[data-studio-status]').textContent = choice === 'partner'
        ? 'Split applied. Enter and verify the X account before launch review.' : 'Split applied to the launch form. Review the final route before signing.';
    });
  }
  const community = byId('community');
  if (community && !byId('community-reward-reserve')) {
    const oldStatus = byId('community-alert-status');
    if (oldStatus) oldStatus.textContent = 'Optional in-app alerts for watched coins are available below.';
    const section = node('section', 'reward-experience-panel', null); section.id = 'community-reward-reserve';
    section.innerHTML = `<header><div><p class="eyebrow">Protocol reserve</p><h2>Community programs reserve</h2><p>Collected SOL is set aside in the fee ledger for future community programs. No jackpot, leaderboard bonus, game, or airdrop payout is active yet.</p></div></header><div data-community-reserve>Checking verified allocations…</div><p class="reward-ideas">Each future program needs published rules and verified payout receipts before any spending is shown here.</p>`;
    community.append(section);
    const alerts = node('section', 'reward-experience-panel reward-alerts', null); alerts.id = 'reward-alerts';
    alerts.innerHTML = `<header><div><p class="eyebrow">Followed coins</p><h2>Reward alerts</h2><p>Get an in-app notice when a watched coin has a newly verified fee collection, holder payment, or buyback burn.</p></div><label><input type="checkbox" data-alert-toggle /> Enable</label></header><div data-alert-status role="status">Alerts are off.</div><div data-alert-list></div><small>Alerts work while this page is open and are saved on this device. They do not promise a payout or run in the background.</small>`;
    community.append(alerts);
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
    section.innerHTML = `<header><div><p class="eyebrow">Fee-funded $FUNDED burn</p><h2>Buyback execution</h2><p>Follow allocated fees through the queue to a verified buy and burn.</p></div></header><div data-buyback-flow role="status">Checking the Devnet buyback queue…</div><small>Launch-tier burns are separate. A buyback does not guarantee a price change.</small>`;
    buybacks.prepend(section);
  }
}

let latest = null;
function renderPortfolio(data, referralData, xData) {
  const body = document.querySelector('[data-reward-portfolio]'); if (!body) return;
  const wallet = data?.wallet;
  body.replaceChildren();
  if (!wallet) { body.textContent = 'Connect a wallet to see your reward records.'; return; }
  if (data.evidence.status === 'unavailable') { body.textContent = 'Finalized receipt coverage is unavailable. Your balances are not shown until it recovers.'; return; }
  const rows = wallet.rows || [];
  const paid = rows.flatMap(row => row.payouts || []);
  const referralClaims = Array.isArray(referralData?.claims) ? referralData.claims.filter(row => row.asset === 'SOL') : null;
  const referralOpen = referralClaims?.filter(row => row.status !== 'paid' && row.status !== 'expired') || [];
  const xClaims = summarizeXClaims(xData?.claims);
  const summary = node('div', 'reward-portfolio-summary');
  const creatorUnpaid = rows.reduce((sum, row) => sum + BigInt(row.creatorWithoutPayoutProofLamports || '0'), 0n);
  for (const [label, value] of [['Creator allocation without payout proof',sol(creatorUnpaid)],
    ['Verified SOL payments',sol(paid.reduce((sum, row) => sum + BigInt(row.amountLamports), 0n))],
    ['Open referral claims',referralClaims ? sol(referralOpen.reduce((sum, row) => sum + decimalLamports(row.amount), 0n)) : 'Unavailable'],
    ['X ready to claim',xClaims ? formatXClaimSol(xClaims.unclaimed) : document.querySelector('#x-sign-in')?.dataset.connected === 'true' ? 'Unavailable' : 'Sign in with X']]) {
    const card = node('div'); card.append(node('small','',label), node('strong','',value)); summary.append(card);
  }
  body.append(summary);
  if (!rows.length) { body.append(node('p','reward-empty','No verified creator or holder payments for this wallet yet. Published rewards do not establish wallet eligibility.')); return; }
  const list = node('div', 'reward-portfolio-list');
  for (const row of rows) {
    const article = node('article');
    const heading = node('div','reward-row-head'); heading.append(link(row.symbol || short(row.mint), tokenUrl(row.mint)));
    heading.append(node('span','',row.creator ? 'Creator' : row.payouts.some(item => item.kind === 'holder') ? 'Holder' : 'Reward recipient'));
    article.append(heading);
    if (row.creator) article.append(node('p','',`${sol(row.creatorAllocatedLamports)} creator allocation · ${sol(row.creatorWithoutPayoutProofLamports)} without payout proof`));
    for (const payment of row.payouts) {
      const line = node('p'); line.append(node('span','',`${payment.kind} · ${sol(payment.amountLamports)} paid · `),
        link('Finalized receipt ↗', explorer(payment.signature), true));
      if (payment.feeSourceVerified && payment.sourceClaims?.length) line.append(node('span','', ' · fee collection linked'));
      article.append(line);
    }
    list.append(article);
  }
  body.append(list);
}
function renderDiscovery(data) {
  const root = document.querySelector('[data-reward-discovery]'); if (!root) return;
  root.replaceChildren();
  if (data?.evidence.status === 'unavailable') { root.textContent = 'Finalized reward discovery is unavailable. Try again shortly.'; return; }
  const filter = document.querySelector('[data-reward-filter]')?.value || 'all';
  const tokens = (data?.tokens || []).filter(row => row.holderSharePercent > 0 &&
    (filter === 'all' || filter === 'allocated' && BigInt(row.totals.holder) > 0n || filter === 'paid' && row.holderPaidWallets > 0));
  if (!tokens.length) { root.textContent = data ? 'No coins match this verified reward state yet.' : 'Reward discovery is unavailable.'; return; }
  const list = node('div', 'reward-discovery-list');
  for (const row of tokens.slice(0, 30)) {
    const article = node('article');
    const title = node('div','reward-row-head');
    const identity = node('div','reward-token-identity');
    if (row.imageUri) {
      const logo = node('img'); logo.src = `/devnet-images/${encodeURIComponent(row.mint)}`;
      logo.alt = ''; logo.loading = 'lazy'; logo.addEventListener('error', () => logo.remove(), { once:true });
      identity.append(logo);
    }
    identity.append(link(`${row.symbol || short(row.mint)} · ${row.name}`, tokenUrl(row.mint)));
    title.append(identity);
    title.append(node('span','',row.status === 'holders-paid' ? 'Holders paid' : row.status === 'holder-fees-allocated' ? 'Fees allocated' : 'Policy published'));
    article.append(title);
    article.append(node('p','',`${row.holderSharePercent}% fee share · ${sol(row.totals.holder)} allocated · ${row.holderPaidWallets} paid wallet${row.holderPaidWallets === 1 ? '' : 's'}`));
    if (row.lastHolderPayout) article.append(node('small','',`Latest recorded holder payment ${new Date(row.lastHolderPayout).toLocaleString()}`));
    list.append(article);
  }
  root.append(list);
}
function renderToken(data) {
  const root = document.querySelector('[data-token-proof]'); if (!root) return;
  root.replaceChildren();
  if (data?.evidence.status === 'unavailable') { root.textContent = 'Finalized fee evidence is unavailable. This page cannot confirm collection or payout totals right now.'; return; }
  const mint = location.pathname.match(/^\/token\/([^/]+)$/)?.[1];
  if (!validMint(mint)) { root.textContent = 'Open a verified token to inspect its reward history.'; return; }
  const row = data?.tokens?.find(item => item.mint === mint);
  if (!row) { root.textContent = data ? 'No finalized fee-route record for this token.' : 'Reward proof is unavailable.'; return; }
  const steps = node('ol','reward-proof-steps');
  const details = [
    ['Policy published',`${row.holderSharePercent}% to coin holders`,true],
    ['Fees collected',`${sol(row.totals.collected)} · ${row.collectionCount} collection receipts`,row.collectionCount > 0],
    ['Fees allocated',`${sol(row.totals.allocated)} across the published policy`,BigInt(row.totals.allocated) > 0n],
    ['Holders paid',`${row.holderPaidWallets} wallets · ${row.holderPayoutCount} finalized payments`,row.holderPayoutCount > 0],
    ['Buyback burned',`${row.buybackBurnCount} verified burns · ${row.buybackBurnedBaseUnits} $FUNDED base units`,row.buybackBurnCount > 0],
  ];
  for (const [title, detail, done] of details) {
    const item = node('li', done ? 'complete' : 'pending'); item.append(node('strong','',title),node('small','',detail)); steps.append(item);
  }
  root.append(steps);
  if (row.holderPayoutCount) root.append(node('p','reward-source-note',row.payoutSource === 'verified-fee-funded-cycle'
    ? 'Every listed holder payment is linked to a verified fee collection and balance-verified funded pool.'
    : 'Some holder payments are finalized, but their funding source is not linked to a specific fee claim in this view.'));
  // Signatures are only rendered as links when they came from the verified API model.
  const eventList = node('div','reward-proof-events');
  for (const event of (data.events || []).filter(item => item.mint === mint).slice(0, 12)) {
    const article = node('div'); article.append(node('span','',`${event.label} · ${sol(event.amountLamports)}`), link('Transaction ↗', explorer(event.signature), true));
    if (event.feeSourceVerified && event.sourceClaims?.length) article.append(link('Source fee claim ↗', explorer(event.sourceClaims[0]), true));
    eventList.append(article);
  }
  if (eventList.children.length) root.append(eventList);
}
function renderCommunity(data) {
  const root = document.querySelector('[data-community-reserve]'); if (!root) return;
  root.replaceChildren();
  if (!data || data.evidence.status === 'unavailable') { root.textContent = 'Finalized community allocation evidence is unavailable.'; return; }
  const block = node('div','reward-community-total'); block.append(node('strong','',sol(data.community.allocatedLamports)),
    node('span','','reserved from finalized, mint-attributed fee collections'));
  root.append(block);
  if (data.community.baseAllocatedLamports != null && data.community.referralRolloverLamports != null) {
    root.append(node('p','',`${sol(data.community.baseAllocatedLamports)} fixed 2% reserve · ${sol(data.community.referralRolloverLamports)} from unassigned referrals`));
  }
  if (data.community.fundedLamports != null && BigInt(data.community.fundedLamports) > 0n) {
    root.append(node('p','',`${sol(data.community.fundedLamports)} transferred to the dedicated on-chain program vault with verified funding receipts.`));
    if (data.community.vaultAddress) root.append(link(`Reserve vault ${short(data.community.vaultAddress)} ↗`, explorer(data.community.vaultAddress), true));
  } else root.append(node('p','', 'Vault funding is pending; the allocation remains in the fee ledger.'));
  root.append(node('p','', 'No community SOL payout program is active. The live vault balance and future spending need separate verification.'));
}
function renderBuybacks(data) {
  const root = document.querySelector('[data-buyback-flow]'); if (!root) return;
  root.replaceChildren();
  if (!data) { root.textContent = 'Buyback status is unavailable.'; return; }
  const pending = (data.pending || []).filter(row => BigInt(row.pendingLamports || '0') > 0n);
  const receipts = (data.receipts || []).filter(row => row.status === 'finalized' && row.refundVerified === true);
  const stats = node('div','reward-buyback-stats');
  for (const [label,value] of [['Queued funds',sol(pending.reduce((sum,row) => sum + BigInt(row.pendingLamports), 0n))],
    ['Verified buy and burns',String(receipts.length)]]) { const item = node('div'); item.append(node('small','',label),node('strong','',value)); stats.append(item); }
  root.append(stats);
  const list = node('div','reward-buyback-list');
  for (const row of pending.slice(0, 8)) {
    const article = node('p'); article.append(link(short(row.mint), tokenUrl(row.mint)),
      node('span','',` · ${sol(row.pendingLamports)} queued · ${row.activeOrder ? 'execution in progress' : row.eligible ? 'eligible for next batch' : 'accumulating'}`));
    list.append(article);
  }
  for (const row of receipts.slice(0, 8)) {
    const article = node('p'); article.append(link(short(row.mint), tokenUrl(row.mint)),
      node('span','',` · ${row.boughtAndBurnedBaseUnits || row.burnedBaseUnits} $FUNDED base units burned · `),
      link('Proof ↗', explorer(row.signature), true)); list.append(article);
  }
  if (!list.children.length) list.append(node('p','reward-empty','No queued fee-funded buyback or verified burn is indexed.'));
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
  if (!list.children.length) list.append(node('p','reward-empty','No new watched reward events since alerts were enabled.'));
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
  for (const event of (data.events || []).slice().reverse()) {
    const key = `${event.kind}:${event.signature}`;
    if (!watched.has(event.mint) || seen.has(key)) continue;
    seen.add(key);
    prefs.notices.push({ mint:event.mint, signature:event.signature, label:event.label, at:event.at });
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
  document.querySelectorAll('[data-reward-evidence]').forEach(element => { element.textContent = latest?.evidence?.status === 'onchain-indexed' ? 'Finalized receipts' : latest?.evidence?.status === 'partial' ? 'Partial receipt coverage' : latest?.evidence?.status === 'no-records' ? 'No finalized receipts yet' : 'Evidence unavailable'; });
  renderPortfolio(latest, referrals.status === 'fulfilled' ? referrals.value : null, xClaims.status === 'fulfilled' ? xClaims.value : null);
  renderDiscovery(scoped ? null : latest); renderToken(scoped ? latest : null);
  renderCommunity(scoped ? null : latest);
  renderBuybacks(buybacks.status === 'fulfilled' ? buybacks.value : null);
  if (!scoped) captureAlerts(latest);
}

createPanels();
renderAlerts();
window.addEventListener('funded:reward-identity-change', refresh);
window.addEventListener('popstate', refresh);
window.addEventListener('hashchange', () => { if (!document.hidden) void refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
void refresh();
