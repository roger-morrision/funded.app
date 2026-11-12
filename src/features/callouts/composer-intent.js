import { el, link, button, address } from '../experience/view-utils.js';

export function mountCalloutIntent(app) {
  const trigger = document.querySelector('.callouts-head > a');
  if (!trigger) return;
  const dialog = el('dialog', null, 'flow-picker');
  dialog.setAttribute('aria-labelledby', 'callout-picker-title');
  const title = el('h2', 'Choose a coin to call'); title.id = 'callout-picker-title';
  const input = el('input'); input.type = 'search'; input.setAttribute('aria-label', 'Search coins for a callout');
  input.placeholder = 'Name, symbol or mint';
  const list = el('div'); list.setAttribute('aria-live', 'polite');
  dialog.append(title, el('p', 'Choose a coin, write your observation, then review and sign the post.'), input, list, button('Close coin picker', () => dialog.close()));
  document.body.append(dialog);
  const render = () => {
    const rows = (window.fundedVerifiedSearchCandidates?.(input.value) || []).filter(row => !row.type && address(row.mint));
    list.replaceChildren();
    for (const row of rows) list.append(link(`${row.name} · ${row.symbol} · ${row.stage}`, `/token/${row.mint}?compose=callout`));
    if (!rows.length) list.append(el('p', 'No matching loaded coins. Refresh Explore to load the directory.'), link('Open Explore', '#explore'));
  };
  list.addEventListener('click', event => { if (event.target.closest('a')) dialog.close(); });
  trigger.addEventListener('click', event => { event.preventDefault(); render(); dialog.showModal(); input.focus(); });
  input.addEventListener('input', render);
  document.addEventListener('funded:verified-search-index', () => { if (dialog.open) render(); });
  dialog.addEventListener('close', () => trigger.focus({preventScroll:true}));

  // The URL carries intent only. Posting still uses the existing authenticated
  // chat flow and the user's explicit submit and wallet signature.
  if (new URL(location.href).searchParams.get('compose') !== 'callout' || !address(app.getCoinMintAddress())) return;
  let fulfilled = false;
  const open = () => {
    if (fulfilled) return;
    app.ensureCoinChatTab();
    const tab = document.querySelector('[data-coin-tab="chat"]');
    if (tab && !tab.classList.contains('active')) tab.click();
    const form = document.querySelector('#coin-chat-form');
    if (!form) return;
    const field = form.querySelector('input:not([type="checkbox"])');
    // Text written in the post-buy call pop-up on another page arrives here for review.
    let draft = ''; try { draft = sessionStorage.getItem('funded.postBuyCall.text') || ''; sessionStorage.removeItem('funded.postBuyCall.text'); } catch { /* optional */ }
    if (field && draft && !field.value) { field.value = draft.slice(0, Number(field.maxLength) > 0 ? Number(field.maxLength) : 280); field.dispatchEvent(new Event('input', { bubbles: true })); }
    field?.focus({preventScroll:true}); form.scrollIntoView({block:'center'});
    fulfilled = true;
    const url = new URL(location.href); url.searchParams.delete('compose'); history.replaceState(history.state, '', url);
  };
  const schedule = () => queueMicrotask(open);
  window.addEventListener('funded:coin-facts', schedule);
  window.addEventListener('funded:coin-chat-rendered', schedule);
  open();
}
