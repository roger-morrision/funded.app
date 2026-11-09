export function mountRichTokenShortcut(mint, document = globalThis.document) {
  const actions = document.querySelector('.topbar .top-actions');
  if (!actions || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
  const link = document.createElement('a');
  link.id = 'header-buy-rich';
  link.className = 'buy-rich-button';
  link.textContent = 'Buy $RICH';
  link.href = `/token/${encodeURIComponent(mint)}`;
  link.title = 'Open the $RICH token page';
  actions.insertBefore(link, actions.querySelector('.create-coin-button'));
}
