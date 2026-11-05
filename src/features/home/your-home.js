// Home panel for a connected wallet: the coins it launched and holds, its
// trader rank today, and the three places it earns. Built only from data the
// app already loaded, so it adds no requests; hidden when no wallet is set.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const shortWallet = address => `${String(address).slice(0, 4)}…${String(address).slice(-4)}`;

export function yourHomeSummary({ wallet, assets = [], policies = [], holdings = null, traders = [] }) {
  if (!wallet) return null;
  const launched = new Set((Array.isArray(policies) ? policies : [])
    .filter(row => row?.onchainVerified && (row.creatorWallet || row.feePayer) === wallet).map(row => row.mint));
  const launchedCoins = assets.filter(item => launched.has(item.address));
  const held = holdings?.wallet === wallet && holdings.status === 'ready' && Array.isArray(holdings.accounts)
    ? holdings.accounts.filter(row => Number(row?.amount ?? row?.uiAmount ?? 1) > 0).length : null;
  const rankIndex = traders.findIndex(row => row.wallet === wallet);
  return { wallet, launched: launchedCoins.length || launched.size, held, rank: rankIndex >= 0 ? rankIndex + 1 : null, rankedCount: traders.length };
}

export function yourHomeMarkup(summary) {
  if (!summary) return '';
  const stat = (label, value, note, href) => `<a class="your-home-stat" href="${href}"><span>${label}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></a>`;
  return `<div class="your-home-head"><div><p class="eyebrow">Your funded.vip</p><h2 id="your-home-title">Welcome back, ${escape(shortWallet(summary.wallet))}</h2></div><a class="text-button" href="#my-launches">Open portfolio →</a></div>
<div class="your-home-grid">
${stat('Your projects', summary.launched, 'Manage your coins and review their activity', '#my-launches')}
${stat('Your holdings', summary.held == null ? 'Unavailable' : summary.held, 'Balances and available prices', '#my-launches')}
${stat('Your rewards', 'Check status', 'Eligibility, claims and confirmed payments', '#payments')}
${stat('Your shortlist', 'Explore', 'Revisit favorites and followed wallets', '#explore')}
</div>`;
}

export function renderYourHome(app, document = globalThis.document) {
  const anchor = document?.querySelector('.hero-section .hero-actions');
  if (!anchor) return;
  let panel = document.querySelector('#your-home');
  const summary = yourHomeSummary({
    wallet: app.connectedWalletAddress,
    assets: Array.isArray(app.assets) ? app.assets : [],
    policies: app.verifiedLaunchPolicies,
    holdings: app.portfolioHoldings,
    traders: app.rankObservedTraders?.(app.assets || [], app.verifiedLaunchPolicies)?.traders || [],
  });
  if (!summary) { if (panel) panel.hidden = true; return; }
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'your-home';
    panel.className = 'your-home panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', 'your-home-title');
    anchor.after(panel);
  }
  const markup = yourHomeMarkup(summary);
  if (panel.dataset.markup !== markup) { panel.innerHTML = markup; panel.dataset.markup = markup; }
  panel.hidden = false;
}
