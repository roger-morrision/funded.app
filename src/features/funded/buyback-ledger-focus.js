// Presentation only. The renderer and concise layout may both replace/move
// descendants; keep logical focus without changing receipt data or actions.
export function preserveBuybackLedgerFocus(ledger, document) {
  const active = document.activeElement;
  if (!active || !ledger.contains(active) || !active.getClientRects().length) return () => {};
  const summary = active.matches('.concise-ledger-more > summary');
  const href = active.matches('a[href]') ? active.getAttribute('href') : null;
  const action = active.textContent;
  // Position is used only to detect reordering, never to choose a receipt.
  const previousIndex = [...ledger.querySelectorAll('a[href]')].indexOf(active);
  if (!summary && !href) return () => {};
  let cancelled = false;
  const moved = event => { if (event.target !== active) cancelled = true; };
  document.addEventListener('focusin', moved);
  return () => {
    // Mutation observers enqueue the concise disclosure's animation frame.
    // Queue ours after that frame so restoring a link is not undone by wrapping.
    queueMicrotask(() => document.defaultView.requestAnimationFrame(() => {
      document.removeEventListener('focusin', moved);
      if (cancelled || !ledger.isConnected || !ledger.getClientRects().length
        || (document.activeElement !== document.body && document.activeElement !== active)) return;
      const more = ledger.querySelector(':scope > .concise-ledger-more > summary');
      const links = [...ledger.querySelectorAll('a[href]')];
      const receipt = href && links
        .find(link => link.getAttribute('href') === href && link.textContent === action);
      // Keep a collapsed disclosure closed if reordering moves a top-level
      // receipt inside it; its summary is a local fallback, never another tx.
      const target = summary ? more : receipt?.getClientRects().length ? receipt : more;
      const next = target || ledger.closest('.buyback-ledger-panel')?.querySelector('h2');
      if (!next?.getClientRects().length) return;
      if (next.tagName === 'H2') next.tabIndex = -1;
      next.focus({preventScroll:true});
      if (document.activeElement !== next) return;
      // Native anchoring tracks concurrent layout updates above this ledger.
      // preventScroll keeps restoring focus from adding another scroll.
      // Preserve stationary history. Only a moved/removed target may need a
      // small instant reveal to keep its focus outline above fixed overlays.
      const retained = summary ? next === more : next === receipt;
      if (!retained || (receipt && links.indexOf(receipt) !== previousIndex)) {
        const box = next.getBoundingClientRect(), view = document.defaultView, style = view.getComputedStyle(next);
        const outline = (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0);
        const header = document.querySelector('.topbar'), nav = document.querySelector('.mobile-workspace-nav');
        const top = header?.getClientRects().length ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
        const bottom = nav?.getClientRects().length ? nav.getBoundingClientRect().top : view.innerHeight;
        const delta = box.top - outline < top ? box.top - outline - top : box.bottom + outline > bottom ? box.bottom + outline - bottom : 0;
        if (delta) view.scrollBy({top:delta < 0 ? Math.floor(delta) : Math.ceil(delta), behavior:'instant'});
      }
    }));
  };
}
