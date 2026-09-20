// Presentation-only enhancements. This module does not infer on-chain success or enable gated actions.
const byId = id => document.getElementById(id);

function addOnce(parent, key, markup, before = null) {
  if (!parent || byId(key)) return null;
  const holder = document.createElement('div');
  holder.innerHTML = markup.trim();
  const node = holder.firstElementChild;
  if (before) parent.insertBefore(node, before);
  else parent.append(node);
  return node;
}

function simplifyExplore() {
  const advanced = document.querySelector('.explore-advanced-fields');
  const windowFilter = document.querySelector('.filter-row .explore-timeframe');
  const signalFilter = byId('explore-risk-filter')?.closest('label');
  if (advanced && windowFilter && signalFilter) {
    advanced.prepend(signalFilter);
    advanced.prepend(windowFilter);
  }
  const label = byId('explore-search');
  if (label) label.setAttribute('aria-label', 'Search verified launches by name, ticker, or mint address');
  const status = byId('explore-data-status');
  if (status) status.setAttribute('role', 'status');
}

function showLaunchPath() {
  const shell = byId('launch-route-shell');
  addOnce(shell, 'launch-path', `<div class="launch-path" id="launch-path" aria-label="Launch path">
    <div><b>1</b><span><strong>Prepare</strong><small>Add token details and a 3%+ community reserve.</small></span></div>
    <div><b>2</b><span><strong>Review</strong><small>Check the fee owner, policy, and Devnet network.</small></span></div>
    <div><b>3</b><span><strong>Sign & verify</strong><small>Approve in your wallet; only a confirmed signature creates a launch record.</small></span></div>
  </div>`);
}

function renderLocalDraft() {
  const workspace = byId('my-launches');
  const panel = workspace?.querySelector('.role-grid');
  if (!panel) return;
  let card = byId('local-launch-draft');
  if (!card) card = addOnce(workspace, 'local-launch-draft', `<article class="local-launch-draft" id="local-launch-draft" hidden>
    <div><span class="eyebrow">Saved on this device · not launched</span><strong id="local-draft-title"></strong><small id="local-draft-time"></small></div>
    <button class="secondary-button" type="button" id="resume-local-draft">Resume draft</button>
  </article>`, panel);
  let draft;
  try { draft = JSON.parse(localStorage.getItem('funded.app.launch.draft') || 'null'); } catch { draft = null; }
  const hasDraft = Boolean(draft && typeof draft === 'object' && (draft['token-name'] || draft['token-symbol']));
  card.hidden = !hasDraft;
  if (!hasDraft) return;
  byId('local-draft-title').textContent = `${draft['token-name'] || 'Untitled coin'}${draft['token-symbol'] ? ` (${draft['token-symbol']})` : ''}`;
  const date = Date.parse(draft.savedAt);
  byId('local-draft-time').textContent = Number.isFinite(date) ? `Saved ${new Date(date).toLocaleString()}` : 'Saved locally';
}

function clarifyDataStates() {
  const payments = byId('payments');
  addOnce(payments?.querySelector('.payments-summary'), 'payments-source-note', `<p id="payments-source-note" class="source-note">Payout balances and history are unavailable until verified claim and transfer receipts are indexed. The claim form below is separate from the receipt feed.</p>`);
  const paymentActivity = byId('payment-list');
  const syncTape = () => { if (byId('open-tape')) byId('open-tape').hidden = !paymentActivity?.children.length; };
  syncTape();
  if (paymentActivity) new MutationObserver(syncTape).observe(paymentActivity, { childList: true });
  payments?.querySelectorAll('.payment-range, .balance-tabs').forEach(group => { if (group.querySelector('button[disabled]')) group.hidden = true; });
  if (payments?.querySelector('.payment-range[hidden]')) byId('payment-filter-status').hidden = true;
  const analytics = byId('analytics-detail');
  const ranges = analytics?.querySelector('.analytics-range');
  if (ranges?.querySelector('button[disabled]')) ranges.hidden = true;
  addOnce(analytics, 'analytics-source-note', `<p id="analytics-source-note" class="source-note">A confirmed mint count is not a fee or payout total. Fee charts and recipients appear only from indexed signatures and receipts.</p>`, analytics?.querySelector('.analytics-kpis'));

  const community = byId('community');
  community?.querySelector('.heading-actions')?.setAttribute('hidden', '');
  const signalList = community?.querySelector('.signal-list');
  const syncSignals = () => {
    const values = [...(signalList?.querySelectorAll('b') || [])].map(node => node.textContent.trim());
    community?.classList.toggle('signals-unavailable', !values.some(value => value && value !== '—' && value !== '0'));
  };
  syncSignals();
  if (signalList) new MutationObserver(syncSignals).observe(signalList, { childList: true, characterData: true, subtree: true });

  const airdrops = byId('airdrops');
  const programCount = byId('claim-program-count');
  const syncPrograms = () => airdrops?.classList.toggle('no-indexed-programs', /^0\b/.test(programCount?.textContent.trim() || ''));
  syncPrograms();
  if (programCount) new MutationObserver(syncPrograms).observe(programCount, { childList: true, characterData: true, subtree: true });
  byId('claim-wallet-state')?.setAttribute('role', 'status');

  const buybacks = byId('buybacks');
  const actions = buybacks?.querySelector('.buyback-preview-actions');
  if (actions && [...actions.querySelectorAll('button')].every(button => button.disabled)) actions.hidden = true;
  const buybackStatus = byId('buyback-preview-status');
  if (buybackStatus) {
    buybackStatus.textContent = 'Enter an example amount to see the policy allocation. Claim recording and burn execution need verified receipts and remain unavailable.';
    buybackStatus.setAttribute('role', 'status');
  }
}

function clarifyReferrals() {
  const faq = byId('referral-faq');
  const toolkit = document.querySelector('.referral-toolkit');
  if (faq && toolkit) toolkit.after(faq);
  const progress = document.querySelector('.referral-progress-steps .complete');
  progress?.classList.remove('complete');
  const panel = document.querySelector('.referral-progress-panel');
  if (panel) {
    const heading = panel.querySelector('h3');
    const badge = panel.querySelector('.data-badge');
    const firstStep = panel.querySelector('.referral-progress-steps small');
    if (heading) heading.textContent = 'How qualification works';
    if (badge) badge.textContent = 'Example path · no events indexed';
    if (firstStep) firstStep.textContent = 'Link click must be recorded';
  }
}

function addContextPanels() {
  const docs = byId('docs');
  addOnce(docs, 'docs-source-map', `<article class="support-card docs-source-map" id="docs-source-map"><p class="eyebrow">Evidence guide</p><h2>What each screen proves</h2><div class="source-map-grid"><div><strong>Launch & token</strong><small>Confirmed Devnet mint and fee-owner checks when RPC data is available.</small></div><div><strong>Payments & analytics</strong><small>Claim and payout totals require indexed transaction receipts.</small></div><div><strong>Airdrops & buybacks</strong><small>Policy previews are not vault balances, claims, trades, or burns.</small></div></div></article>`, docs?.firstElementChild);
  const privacy = byId('privacy');
  addOnce(privacy, 'privacy-safety-steps', `<div class="safety-steps" id="privacy-safety-steps"><div><strong>Before signing</strong><small>Verify Solana Devnet, the exact amount, recipient, and program in your wallet.</small></div><div><strong>After signing</strong><small>Open the transaction on Solana Explorer and wait for confirmation. A submitted transaction is not a payout receipt.</small></div><div><strong>If something looks wrong</strong><small>Reject the signature. Never enter a seed phrase or private key into this page.</small></div></div>`);
  const paid = byId('paid');
  addOnce(paid, 'paid-status', `<div class="source-note" id="paid-status"><strong>Current status · Devnet preview</strong><span>Fee-route policy can be reviewed before signing. Production settlement, automated recipient payouts, and $FUNDED burns are not live. Any figures below are allocation policy, not paid totals.</span></div>`, paid?.querySelector('.revenue-model'));
  const profile = byId('profile');
  addOnce(profile, 'profile-source-note', `<p class="source-note" id="profile-source-note">Your wallet connection identifies the signer for this browser session. It does not prove a launch, holding, payout, or eligibility until the corresponding Devnet record is verified.</p>`, profile?.querySelector('.profile-grid'));
  const wallet = byId('wallet-page');
  addOnce(wallet?.querySelector('.wallet-detail-card'), 'wallet-source-note', `<p class="source-note" id="wallet-source-note">This page verifies an address associated with a token record. Holdings, trades, and payouts for this wallet are not indexed here.</p>`);
}

function addCoinSections() {
  const page = byId('coin-page');
  if (!page) return;
  const panels = [
    ['Snapshot', page.querySelector('.coin-chart-panel')],
    ['Activity', page.querySelector('.coin-tabs-panel')],
    ['Trade', byId('trade-panel')],
    ['On-chain checks', page.querySelector('.coin-policy-card')],
  ];
  const nav = document.createElement('nav');
  nav.className = 'coin-section-nav';
  nav.setAttribute('aria-label', 'Token page sections');
  for (const [label, target] of panels) {
    if (!target) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => target.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    nav.append(button);
  }
  page.querySelector('.coin-stat-strip')?.after(nav);
}

simplifyExplore();
showLaunchPath();
renderLocalDraft();
clarifyDataStates();
clarifyReferrals();
addContextPanels();
addCoinSections();

byId('save-launch-draft')?.addEventListener('click', () => queueMicrotask(renderLocalDraft));
byId('resume-local-draft')?.addEventListener('click', () => byId('launch-route-shell')?.querySelector('[data-open-launch]')?.click());
