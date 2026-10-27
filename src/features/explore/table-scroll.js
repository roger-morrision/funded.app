import { revealNativeRegistryPrimary } from './registry-view.js';

// Keep the extra tab stop and scroll guidance tied to actual layout overflow,
// including when Grid/Table visibility or the viewport changes.
export function initializeExploreTableScroll(document = globalThis.document) {
  const table = document.querySelector('.scanner-scroll');
  const help = document.querySelector('#scanner-scroll-help');
  if (!table || !help) return;
  const update = () => {
    const overflowing = table.clientWidth > 0 && table.scrollWidth > table.clientWidth + 1;
    help.hidden = !overflowing;
    if (overflowing) table.setAttribute('tabindex', '0');
    else table.removeAttribute('tabindex');
    table.setAttribute('aria-describedby', overflowing ? 'scanner-note scanner-scroll-help' : 'scanner-note');
  };
  const view = document.defaultView;
  let focusFrame = 0;
  const cancelFocusReveal = () => { view?.cancelAnimationFrame(focusFrame); focusFrame = 0; };
  table.addEventListener('focusin', event => {
    cancelFocusReveal();
    const anchor = event.target;
    if (!view || !anchor.matches?.('a.scanner-token-link')) return;
    // Native focus scrolling runs first. Recheck the original owner before
    // moving only its remaining covered outline; visible links do not move.
    focusFrame = view.requestAnimationFrame(() => {
      focusFrame = 0;
      revealNativeRegistryPrimary(anchor, document);
    });
  });
  table.addEventListener('focusout', cancelFocusReveal);
  view?.addEventListener('wheel', cancelFocusReveal, { passive:true, capture:true });
  view?.addEventListener('pointerdown', cancelFocusReveal, true);
  if (view?.ResizeObserver) {
    const observer = new view.ResizeObserver(update);
    observer.observe(table);
    const header = table.querySelector('.scanner-head');
    if (header) observer.observe(header);
  } else view?.addEventListener('resize', update);
  update();
}
