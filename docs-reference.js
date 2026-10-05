const topics = [
  {
    group: 'Getting started',
    items: [
      { id: 'overview', title: 'What is funded.vip?', body: '<p>funded.vip is a Solana launch and discovery workspace. It shows confirmed launches, the published fee policy, and on-chain data when that evidence is available.</p><p>Launch records, market estimates, reserved allocations, and paid receipts are different things. The app labels each so you can check what has actually happened.</p><ul><li>Launch a token through the verified Pump route.</li><li>Find funded.vip launches in Launch Directory and inspect each coin page.</li><li>Review reward policies and confirmed receipts before relying on a payout.</li></ul>', href: '#explore', link: 'Open Launch Directory' },
      { id: 'wallet', title: 'Connecting a wallet', body: '<p>Connect a Solana wallet to review actions that require your signature. The app never asks for a seed phrase or private key.</p><p>Check the network, token mint, spending amount, and fee owner in your wallet before approving. A connected wallet alone is not proof that a launch, trade, burn, or claim succeeded.</p>', href: '#privacy', link: 'Read wallet safety' },
      { id: 'funded', title: 'The $FUNDED token', body: '<p>$FUNDED is the protocol token used by optional launch promotion tiers and the published buyback and burn policy.</p><p>Token burns reduce supply only when confirmed on-chain. A promotion badge requires the corresponding verified launch policy and burn receipt.</p>', href: '#paid', link: 'View $FUNDED and fee policy' },
    ],
  },
  {
    group: 'Launching a coin',
    items: [
      { id: 'tiers', title: 'Launch tiers', body: '<p>Choose Standard or an optional $FUNDED burn tier before filling in coin details. The launch form shows the current configured burn amounts and benefits.</p><p>A paid-tier burn must fit in the creation transaction. If it cannot, the app blocks the launch before signing. A selected tier is a choice; it becomes a verified badge only after the required on-chain evidence exists.</p>', href: '#launch', link: 'Compare launch tiers' },
      { id: 'tier-verification', title: 'Paid-tier verification', body: '<p>Boost, Pro, and Premier are optional $FUNDED burn tiers. The selected tier appears on a coin only when the launch policy and its burn receipt have been verified.</p><p>Check the burn amount, mint, and transaction signature before relying on a badge. A tier signals a confirmed commitment; it does not guarantee trading activity or an airdrop distribution.</p>', href: '#launch', link: 'Review the tier choices' },
      { id: 'launch', title: 'Launch a token', body: '<p>Choose a tier, enter the token name and ticker, add an image, then configure the community reserve and fee route. Any story entered in the form is published with the launch metadata, so review it before signing. The review step shows the estimated cost and the values you are about to sign.</p><p>Creating a token and observing its mint, fee owner, and policy on Solana are separate verification steps. The launch page reports the result after the transaction and account checks complete.</p>', href: '#launch', link: 'Open launch form' },
      { id: 'airdrop-policy', title: 'Community airdrop', body: '<p>Each funded.vip launch reserves at least 3% of supply in its published policy. A policy allocation does not establish that a vault was funded.</p><p>Claims require a verified vault, a finalized migration snapshot, a published proof, and confirmed claim receipts. The airdrop page shows which of those records are available.</p>', href: '#airdrops', link: 'Review airdrop programs' },
    ],
  },
  {
    group: 'Trading and coin pages',
    items: [
      { id: 'coin-pages', title: 'Coin pages', body: '<p>Each coin page brings the token identity, on-chain snapshot, market activity, and launch policy together. A curve estimate is not the same as a migrated pool, and missing market data stays unavailable.</p><p>Use the on-chain checks and addresses before interacting with a token.</p>', href: '#explore', link: 'Find a coin' },
      { id: 'trading', title: 'Buying and selling', body: '<p>Open a verified coin and preview the trade quote, slippage, and maximum spend before approving a wallet transaction. Trading controls remain unavailable when the required route or quote cannot be verified.</p><p>A submitted transaction is not a completed trade. Check the finalized signature and expected token balance change.</p>', href: '#explore', link: 'Explore tradeable coins' },
      { id: 'enhanced-page', title: 'Enhanced coin page', body: '<p>The launch form previews an extended coin profile with artwork, project story, links, and roadmap. The coin page displays those details when a verified launch record contains them.</p><p>Profile content is supplied by the creator. Confirm the mint, launch policy, and on-chain market data separately before trading.</p>', href: '#launch', link: 'Preview the coin profile' },
    ],
  },
  {
    group: 'Discovery and rewards',
    items: [
      { id: 'index', title: 'Launch Directory and boosts', body: '<p>Filter confirmed funded.vip launches by stage and verified promotion tier, then compare market cap, volume, trades, and reserve data in the table.</p><p>Boost actions show the configured Solana burn route and required confirmation. Paid listings appear only after the mint and burn are verified.</p>', href: '#explore', link: 'Open Launch Directory' },
      { id: 'leaderboard', title: 'Leaderboard', body: '<p>The creator table ranks activity available from confirmed launches in the current feed. Trader and referral rankings stay unavailable until their activity can be verified.</p>', href: '#leaderboard', link: 'View leaderboard' },
      { id: 'claims', title: 'Claiming rewards', body: '<p>Connect the eligible wallet and review the program evidence before any claim. A reserved allocation or policy percentage is not a claimable balance.</p><p>Claim controls open only after the required funding, snapshot, proof, and receipt checks are available.</p>', href: '#airdrops', link: 'Check airdrops' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { id: 'fees', title: 'Fees and costs', body: '<p>The published creator-fee policy routes 80% of gross collected fees to creator-directed destinations and 20% to protocol programs. The protocol share includes operations, referrals, community, and $FUNDED burn policy allocations.</p><p>These rates describe policy. Actual payouts and burns require finalized, indexed receipts.</p>', href: '#capital-flow', link: 'Review fee flow' },
      { id: 'verification', title: 'What is live?', body: '<p>Launch and trade availability depend on a verified router, Pump route, pool, and RPC response. Receipt totals depend on confirmed indexing.</p><p>Missing proof stays blank or unavailable. A rendered screen does not prove a launch or payout.</p>', href: '#docs', link: 'Review the evidence cards below' },
      { id: 'faq', title: 'FAQ', body: '<h3>Are the coins real?</h3><p>Confirmed launches create Solana tokens. Use the mint and transaction links on the coin page to inspect their on-chain records.</p><h3>Does connecting a wallet move funds?</h3><p>No. A wallet connection only provides an address. Transactions require a separate wallet approval.</p><h3>When can I claim an airdrop?</h3><p>After the token vault, eligibility snapshot, and claim proof have been verified. A policy reserve by itself is not a claimable balance.</p><h3>Where can I check a burn?</h3><p>Open the burn receipt from the tier badge or burn record and verify its transaction on Solana.</p>', href: '#airdrops', link: 'Check airdrop status' },
    ],
  },
];

export function mountDocsReference(root) {
  if (!root || root.querySelector('.docs-guide-layout')) return;
  const shell = document.createElement('div');
  shell.className = 'docs-guide-layout';
  const nav = document.createElement('nav');
  nav.className = 'docs-guide-nav';
  nav.setAttribute('aria-label', 'Documentation topics');
  nav.innerHTML = '<a class="docs-back" href="#overview">← Back to home</a>';
  const article = document.createElement('article');
  article.className = 'docs-guide-article';
  article.id = 'docs-guide-article';
  article.tabIndex = -1;
  const flat = topics.flatMap(group => group.items);
  let selected = 0;
  const buttons = new Map();
  const indexFromHash = () => flat.findIndex(topic => location.hash === `#docs/${topic.id}`);
  const select = (index, focus = false, updateHash = true) => {
    selected = (index + flat.length) % flat.length;
    const topic = flat[selected];
    for (const [id, button] of buttons) {
      const active = id === topic.id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    article.innerHTML = `<p class="eyebrow">${topics.find(group => group.items.includes(topic)).group}</p><h1>${topic.title}</h1><div class="docs-guide-body">${topic.body}</div><a class="docs-guide-link" href="${topic.href}">${topic.link} →</a><div class="docs-guide-next"><span>NEXT →</span><button type="button">${flat[(selected + 1) % flat.length].title}</button></div>`;
    article.querySelector('.docs-guide-next button').addEventListener('click', () => select(selected + 1, true));
    if (focus) article.focus({ preventScroll: true });
    if (updateHash && location.hash !== `#docs/${topic.id}`) location.hash = `#docs/${topic.id}`;
  };
  for (const group of topics) {
    const label = document.createElement('p');
    label.className = 'docs-guide-group';
    label.textContent = group.group;
    nav.append(label);
    for (const topic of group.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = topic.title;
      button.setAttribute('aria-controls', article.id);
      button.addEventListener('click', () => select(flat.indexOf(topic), true));
      buttons.set(topic.id, button);
      nav.append(button);
    }
  }
  nav.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !event.target.matches('button')) return;
    event.preventDefault();
    const current = flat.findIndex(topic => buttons.get(topic.id) === event.target);
    const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
    buttons.get(flat[next].id).focus();
  });
  shell.append(nav, article);
  const oldCards = [...root.querySelectorAll(':scope > .support-card')];
  if (oldCards.length) {
    const more = document.createElement('details');
    more.className = 'docs-more';
    more.innerHTML = '<summary>More policy and evidence guides</summary>';
    const grid = document.createElement('div');
    grid.className = 'docs-more-grid';
    grid.append(...oldCards);
    more.append(grid);
    root.prepend(shell);
    root.append(more);
  } else root.prepend(shell);
  window.addEventListener('hashchange', () => {
    const index = indexFromHash();
    if (index >= 0 && index !== selected) select(index, false, false);
    else if (location.hash === '#docs' && selected !== 0) select(0, false, false);
  });
  select(Math.max(0, indexFromHash()), false, false);
}
