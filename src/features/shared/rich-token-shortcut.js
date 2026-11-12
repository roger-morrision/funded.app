// Open the configured token directly from the top bar, without connecting a wallet.
export function mountRichTokenShortcut(mint, document = globalThis.document, { mainnet = false } = {}) {
  const validMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint);
  // Mainnet has no in-app launches: the primary header action buys $RICH.
  const create = mainnet ? document.querySelector('.top-actions .create-coin-button') : null;
  if (create) {
    create.id = 'header-buy-rich';
    create.firstChild.textContent = 'Buy $RICH ';
    create.href = validMint ? `/token/${encodeURIComponent(mint)}` : '/rich';
    create.title = 'Open the $RICH token page';
    mountMainnetLaunchRedirects(create.href, document);
    return;
  }
  const nav = document.querySelector('.top-actions');
  if (!nav || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || document.getElementById('header-buy-rich')) return;
  const link = document.createElement('a');
  link.id = 'header-buy-rich';
  link.className = 'header-buy-rich';
  link.textContent = 'Buy $RICH';
  link.href = `/token/${encodeURIComponent(mint)}`;
  link.title = 'Open the $RICH token page';
  nav.prepend(link);
}

export function mountWalletMenuNotifications(document = globalThis.document) {
  const nav = document.querySelector('#wallet-popover nav');
  const bell = document.getElementById('notifications-button');
  if (!nav || !bell || document.getElementById('wallet-popover-notifications')) return;
  const item = document.createElement('button');
  item.type = 'button';
  item.id = 'wallet-popover-notifications';
  item.setAttribute('role', 'menuitem');
  item.textContent = 'Notifications';
  // Reuse the existing bell handlers (dialog + activity render) without duplicating them.
  item.addEventListener('click', () => bell.click());
  nav.append(item);
}

// Mainnet runs without the Richpad launch program: every "Create a coin" entry
// point becomes "Buy $RICH", the #launch route opens the $RICH page, and the
// sidebar Analytics item gives way to Daily bonuses (already in the sidebar).
export function mountMainnetLaunchRedirects(richHref, document = globalThis.document) {
  const relabel = link => {
    if (link.id === 'header-buy-rich' || link.dataset.mainnetLaunch) return;
    const text = [...link.childNodes].reverse().find(node => node.nodeType === 3 && node.nodeValue.trim());
    // Launch-guide cards and steps ("Prepare your coin", fee-split cards) do not
    // apply without the launch program, so they are hidden rather than relabelled.
    if (!/^\s*(?:create a coin|create)\s*$/i.test(text?.nodeValue || link.textContent || '')) {
      link.dataset.mainnetLaunch = 'hidden'; link.hidden = true; link.style.setProperty('display', 'none', 'important'); return;
    }
    link.dataset.mainnetLaunch = 'buy-rich';
    link.href = richHref; link.title = 'Open the $RICH token page';
    if (text) text.nodeValue = 'Buy $RICH';
    else link.textContent = 'Buy $RICH';
  };
  const sweep = () => {
    document.querySelectorAll('a[href="#launch"]').forEach(relabel);
    document.querySelectorAll('.nav-item[href="#analytics-detail"]').forEach(item => { item.hidden = true; item.style.display = 'none'; });
  };
  sweep();
  new MutationObserver(records => { if (records.some(record => record.addedNodes.length)) sweep(); })
    .observe(document.body, { subtree: true, childList: true });
  const route = () => { if (/^#launch(?:\/|$)/.test(globalThis.location?.hash || '')) globalThis.location.replace(richHref); };
  route(); globalThis.addEventListener?.('hashchange', route);
}
