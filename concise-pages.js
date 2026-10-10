// Reorganize secondary information without changing data, policies, or transaction controls.
function compactHomeJackpot() {
  const spotlight = document.querySelector('.home-jackpot-spotlight');
  const status = spotlight?.querySelector('[data-home-jackpot-status]');
  if (!spotlight || !status) return;
  if (!status.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(status, { childList: true, characterData: true, subtree: true });
    status.dataset.conciseObserved = '1';
  }
  spotlight.classList.toggle('concise-unavailable', /inactive|unavailable|not funded/i.test(status.textContent));
}

function compactAirdrop() {
  const root = document.getElementById('airdrops');
  if (!root) return;
  const intro = root.querySelector('.airdrop-intro');
  if (intro) intro.textContent = 'Browse launch airdrops, then check your wallet when a claim window opens.';
  const directory = root.querySelector('.airdrop-public-programs');
  const poster = root.querySelector('.airdrop-trust:has([data-infographic-poster="airdrops"])');
  if (directory && poster && directory.nextElementSibling !== poster) directory.after(poster);
}

function compactJackpot() {
  const root = document.getElementById('payments');
  const disclosure = root?.querySelector('.jackpot-disclosure');
  const heading = root?.querySelector('#rewards-overview > .workspace-page-header');
  const summary = disclosure?.querySelector(':scope > summary');
  if (!disclosure || !heading || !summary) return;
  if (!disclosure.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(summary, { childList: true, characterData: true, subtree: true });
    disclosure.dataset.conciseObserved = '1';
  }
  const mode = summary.textContent.includes('inactive') ? 'inactive' : 'active';
  if (mode === disclosure.dataset.conciseMode) return;
  if (mode === 'active') {
    heading.after(disclosure);
    disclosure.open = true;
  } else {
    root.append(disclosure);
    disclosure.open = false;
  }
  disclosure.dataset.conciseMode = mode;
}

function compactBuyback() {
  const root = document.getElementById('buybacks');
  if (!root) return;
  const actions = root.querySelector('.burn-center-layout');
  const execution = root.querySelector('#verified-buyback-flow');
  if (actions && execution && actions.nextElementSibling !== execution) actions.after(execution);

  const flow = execution?.querySelector('[data-buyback-flow]');
  if (flow && !flow.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(flow, { childList: true });
    flow.dataset.conciseObserved = '1';
  }
  const queue = flow?.querySelector(':scope > .reward-buyback-list');
  if (queue) {
    let disclosure = flow.querySelector(':scope > .concise-buyback-queue');
    if (!disclosure) {
      disclosure = document.createElement('details');
      disclosure.className = 'concise-buyback-queue';
      const summary = document.createElement('summary');
      summary.textContent = 'View pending and completed buys';
      disclosure.append(summary);
      queue.before(disclosure);
    }
    disclosure.append(queue);
  }

  for (const [selector, label, className] of [
    ['.burn-policy-preview', 'Preview the 5% allocation', 'concise-policy-preview'],
    ['.burn-tier-card', 'Launch tier burn amounts', 'concise-tier-preview'],
  ]) {
    const panel = root.querySelector(selector);
    if (!panel) continue;
    const existing = panel.parentElement?.tagName === 'DETAILS' ? panel.parentElement : null;
    if (existing) {
      const redundant = existing.parentElement?.tagName === 'DETAILS' && existing.parentElement.classList.contains(className)
        ? existing.parentElement : null;
      if (redundant) redundant.replaceWith(existing);
      existing.classList.add(className);
      const summary = existing.querySelector(':scope > summary');
      if (summary && summary.textContent !== label) summary.textContent = label;
      continue;
    }
    if (panel.closest(`.${className}`)) continue;
    const disclosure = document.createElement('details');
    disclosure.className = className;
    const summary = document.createElement('summary');
    summary.textContent = label;
    panel.before(disclosure);
    disclosure.append(summary, panel);
  }
  const ledger = root.querySelector('#buyback-ledger');
  if (ledger && !ledger.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(ledger, { childList: true });
    ledger.dataset.conciseObserved = '1';
  }
  const rows = ledger ? [...ledger.querySelectorAll(':scope > .buyback-ledger-row')] : [];
  const extras = rows.slice(3);
  if (extras.length) {
    let more = ledger.querySelector(':scope > .concise-ledger-more');
    if (!more) {
      more = document.createElement('details');
      more.className = 'concise-ledger-more';
      const summary = document.createElement('summary');
      more.append(summary);
      rows[3].before(more);
    }
    more.querySelector('summary').textContent = `View ${extras.length} more receipts`;
    more.append(...extras);
  }
}

function compactTokenStory() {
  const story = document.querySelector('#paid .funded-token-story');
  if (!story || story.dataset.conciseStory === '2') return;
  story.innerHTML = '<article><h2>Launch tiers</h2><p>Burn $FUNDED to choose a tier. Standard is free; tiers do not promise returns.</p></article><article><h2>Holder rewards</h2><p>Check each launch for eligibility and claim dates. <a href="#airdrops">View airdrops →</a></p></article><article><h2>How fees are shared</h2><p>Collected fees support creators, holders, referrals, community rewards, and buybacks. <a href="#capital-flow">View the fee split →</a></p></article>';
  story.dataset.conciseStory = '2';
}

function compactRewardsSpotlight() {
  const spotlight = document.querySelector('#rewards-overview .jackpot-overview-spotlight');
  const status = spotlight?.querySelector('[data-jackpot-overview-status]');
  if (!spotlight || !status) return;
  if (!status.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(status, { childList: true, characterData: true, subtree: true });
    status.dataset.conciseObserved = '1';
  }
  spotlight.classList.toggle('concise-unavailable', /inactive|unavailable|not open/i.test(status.textContent));
}

function compactRewardDirectory() {
  const root = document.querySelector('#reward-discovery [data-reward-discovery]');
  if (!root) return;
  if (!root.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(root, { childList: true });
    root.dataset.conciseObserved = '1';
  }
  const list = root.querySelector('.reward-discovery-list');
  const count = list?.querySelectorAll(':scope > article').length || 0;
  let button = root.querySelector(':scope > .concise-reward-more');
  if (count <= 3) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement('button');
    button.className = 'concise-reward-more';
    button.type = 'button';
    button.addEventListener('click', () => {
      root.classList.toggle('concise-expanded');
      compactRewardDirectory();
    });
    list.after(button);
  }
  button.textContent = root.classList.contains('concise-expanded') ? 'Show fewer coins' : `View all ${count} coins`;
  button.setAttribute('aria-expanded', String(root.classList.contains('concise-expanded')));
}

function compactCommunityReserve() {
  const reserve = document.getElementById('community-reward-reserve');
  if (!reserve || reserve.parentElement?.classList.contains('concise-community-reserve')) return;
  const disclosure = document.createElement('details');
  disclosure.className = 'concise-community-reserve';
  const summary = document.createElement('summary');
  summary.textContent = 'Community reserve';
  reserve.before(disclosure);
  disclosure.append(summary, reserve);
}

function compactHolderDirectory() {
  const section = document.getElementById('funded-holder-token-rewards');
  const list = section?.querySelector('[data-funded-token-list]');
  if (!list) return;
  if (!list.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(list, { childList: true });
    list.dataset.conciseObserved = '1';
  }
  const count = list.querySelectorAll(':scope > li:has(.funded-token-row)').length;
  let button = section.querySelector(':scope > .concise-holder-more');
  if (count <= 4) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement('button');
    button.className = 'concise-holder-more';
    button.type = 'button';
    button.addEventListener('click', () => {
      section.classList.toggle('concise-expanded');
      compactHolderDirectory();
    });
    list.after(button);
  }
  button.textContent = section.classList.contains('concise-expanded') ? 'Show fewer tokens' : `View all ${count} tokens`;
  button.setAttribute('aria-expanded', String(section.classList.contains('concise-expanded')));
}

function compactRecipients() {
  const panel = document.querySelector('#analytics-detail .recipients-panel');
  const list = panel?.querySelector('.payment-list');
  if (!list) return;
  if (!list.dataset.conciseObserved) {
    new MutationObserver(refreshConcisePages).observe(list, { childList: true });
    list.dataset.conciseObserved = '1';
  }
  const count = list.querySelectorAll(':scope > .payment-row').length;
  let button = panel.querySelector(':scope > .concise-recipient-more');
  if (count <= 5) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement('button');
    button.className = 'concise-recipient-more';
    button.type = 'button';
    button.addEventListener('click', () => {
      panel.classList.toggle('concise-expanded');
      compactRecipients();
    });
    list.after(button);
  }
  button.textContent = panel.classList.contains('concise-expanded') ? 'Show fewer receipts' : `View all ${count} receipts`;
  button.setAttribute('aria-expanded', String(panel.classList.contains('concise-expanded')));
}

function shortenPageCopy() {
  const edits = [
    ['#payments > .workspace-page-header > p:last-child', 'Claim rewards and track your payments.'],
    ['#my-launches > .section-heading .panel-explainer', 'Your launches and saved tokens.'],
    ['#capital-flow > .section-heading .panel-explainer', 'See how collected creator fees are shared.'],
    ['#launch-route-shell > .page-lede', 'Add your token details, choose rewards, and review the total before signing.'],
    ['#buybacks .burn-center-hero > p:not(.eyebrow)', 'Burn permanently. Verify the receipt on-chain.'],
    ['#community .section-heading .panel-explainer', 'Save coins from Explore to watch them here.'],
    ['#reward-alerts > header p:not(.eyebrow)', 'Get alerts for verified activity on saved coins.'],
    ['#reward-alerts > small', 'Alerts work while this page is open. No payout is guaranteed.'],
    ['#capital-flow-title', 'Where every SOL goes'],
    ['#capital-flow .route-timeline-panel h2', 'From fee to receipt'],
    ['#capital-flow .route-timeline li:nth-child(1) small', 'Pump trading accrues creator fees.'],
    ['#capital-flow .route-timeline li:nth-child(2) small', 'The claim signature prevents duplicates.'],
    ['#capital-flow .route-timeline li:nth-child(3) small', 'Five allocations are recorded together.'],
    ['#capital-flow .route-timeline li:nth-child(4) small', 'Transfers reference the original claim.'],
    ['#capital-flow .route-timeline li:nth-child(5) small', 'Explorer links appear after verification.'],
    ['#analytics-detail .split-detail', 'This shows the published fee split. Actual payments appear after confirmation.'],
    ['#token-image-help', 'PNG, JPG, WEBP · 12 MB max · square image recommended'],
    ['#launch-route-shell .launch-immutable-note', 'Token details publish at launch and cannot be edited here later.'],
    ['#referral-command-center .section-heading .panel-explainer', 'Track qualified creators and claimable rewards. Signups alone earn nothing.'],
    ['#referral-command-center .referral-share-panel .field-help', 'Use one link per campaign. Never promise returns.'],
    ['#referral-faq .faq-grid details:nth-child(1) p', 'Rewards become available after a referred creator earns fees and those fees are collected. Signups alone earn nothing.'],
    ['#referral-faq .faq-grid details:nth-child(2) p', 'Unfilled levels go to the community reserve; they are not reassigned.'],
    ['#referral-faq .faq-grid details:nth-child(3) p', 'Rates are policy, not promised income. Payouts depend on collected creator fees.'],
    ['#referral-faq .faq-grid details:nth-child(4) p', 'A failed or unconfirmed fee collection earns nothing. A claim opens after payment is confirmed.'],
    ['#buybacks .burn-buy-card > p:not(.eyebrow):not(.funded-burn-status)', 'Buy from the verified Solana pool. Check spend, then approve in your wallet.'],
    ['#buybacks .burn-token-card > p:not(.eyebrow):not(.funded-burn-status)', 'Choose a project if you want to link this burn to it, then approve in your wallet.'],
    ['#buybacks .burn-receipts-panel > .field-help', 'This history shows confirmed burns recorded by funded.vip. Total supply can include other burns.'],
    ['#reward-portfolio .reward-portfolio-note', 'Allocations are not balances. Holder SOL is automatic after a verified snapshot; X claims need matching sign-in.'],
    ['#reward-discovery > small', 'Eligible wallets receive SOL automatically when funds are available. “0 paid wallets” means no holder payment is confirmed.'],
    ['#payments .auto-rewards-intro', 'Eligible coin holders receive SOL automatically once funding and eligibility are confirmed. No manual claim is needed.'],
    ['#payments .auto-reward-card:nth-child(1) > p', 'Eligible wallets receive SOL after the daily eligibility check and funding confirmation.'],
    ['#payments .auto-rewards-fineprint', 'Target time is not payment. Each cycle checks funding and eligibility.'],
    ['#funded-holder-token-rewards > small', 'Public policy only. Check Airdrops for funding and claim status.'],
    ['#airdrops .airdrop-trust > p', 'Claims open after eligibility and funding have been confirmed.'],
    ['#list .list-field-note', 'Verified Solana metadata supplies name and ticker. Mint and burn are rechecked before payment.'],
    ['#profile .section-heading .panel-explainer', 'Check wallet and network before signing.'],
    ['#profile .source-note', 'Connecting shows which wallet will sign. Check each transaction before approving.'],
  ];
  for (const [selector, copy] of edits) {
    const element = document.querySelector(selector);
    if (element && element.textContent !== copy) element.textContent = copy;
  }
}

// Reuse one short visual per money flow. The policy numbers live in HTML so they
// remain selectable, accessible, and exact even when the artwork is resized.
const moneyFlowPosters = [
  {
    selector: '[data-page-infographic="analytics"]', image: 'fee-collection-flow-v1.webp',
    key: 'collection', title: 'FEE COLLECTION', metric: '100%',
    metricLabel: 'claimed creator fees routed',
    steps: ['Accrue', 'Verified claim', 'Router receipt'],
  },
  {
    selector: '[data-page-infographic="capital"]', image: 'fee-distribution-flow-v1.webp',
    key: 'distribution', title: 'CLAIMED FEE SPLIT', metric: '80% / 20%',
    metricLabel: 'creator-directed / protocol',
    steps: ['10% Ops', '3% Referrals', '2% Community', '5% Buyback/burn'],
  },
  {
    selector: '[data-infographic-poster="fees"]', image: 'fee-distribution-flow-v1.webp',
    key: 'distribution', title: 'CLAIMED FEE SPLIT', metric: '80% / 20%',
    metricLabel: 'creator-directed / protocol',
    steps: ['10% Ops', '3% Referrals', '2% Community', '5% Buyback/burn'],
  },
  {
    selector: '[data-infographic-poster="rewards"]', image: 'holder-rewards-flow-v1.webp',
    key: 'rewards', title: 'REWARD DISTRIBUTION', metric: '80%',
    metricLabel: 'creator-directed fee pool',
    steps: ['Creator wallet', 'Holder + X per token', 'Payout receipt'],
  },
  {
    selector: '[data-page-infographic="holder"]', image: 'holder-rewards-flow-v1.webp',
    key: 'rewards', title: 'HOLDER SOL PAYOUTS', metric: '0–80%',
    metricLabel: 'holder share set per token',
    steps: ['Daily snapshot', '≥0.01 SOL payout', 'Receipt'],
  },
];

function decorateMoneyFlowPosters() {
  for (const flow of moneyFlowPosters) {
    const poster = document.querySelector(flow.selector);
    const figure = poster?.querySelector('figure');
    const picture = figure?.querySelector('img');
    if (!poster || !figure || !picture || poster.dataset.moneyFlowPoster) continue;
    poster.dataset.moneyFlowPoster = flow.key;
    poster.setAttribute('aria-label', flow.title);
    picture.src = `/posters/${flow.image}`;
    picture.alt = '';

    const copy = document.createElement('figcaption');
    copy.className = 'money-flow-caption';
    const top = document.createElement('span');
    top.className = 'money-flow-top';
    const heading = document.createElement('strong');
    heading.textContent = flow.title;
    const stat = document.createElement('span');
    stat.className = 'money-flow-stat';
    const metric = document.createElement('b');
    metric.textContent = flow.metric;
    const metricLabel = document.createElement('small');
    metricLabel.textContent = flow.metricLabel;
    stat.append(metric, metricLabel);
    top.append(heading, stat);
    const steps = document.createElement('span');
    steps.className = 'money-flow-steps';
    for (const label of flow.steps) {
      const item = document.createElement('span');
      item.textContent = label;
      steps.append(item);
    }
    copy.append(top, steps);
    figure.append(copy);
  }
}

let compactPending = false;
function refreshConcisePages() {
  if (compactPending) return;
  compactPending = true;
  requestAnimationFrame(() => {
    compactPending = false;
    compactHomeJackpot();
    compactAirdrop();
    compactJackpot();
    compactBuyback();
    compactTokenStory();
    compactRewardsSpotlight();
    compactRewardDirectory();
    compactCommunityReserve();
    compactHolderDirectory();
    compactRecipients();
    shortenPageCopy();
    decorateMoneyFlowPosters();
  });
}
function startConcisePages() {
  refreshConcisePages();
  const observer = new MutationObserver(refreshConcisePages);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 16000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startConcisePages, { once: true });
else startConcisePages();
