export function createExploreEmptyAction(document, { hasAssets, exploreTab }) {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'explore-empty-action';
  action.dataset.exploreEmptyAction = hasAssets ? 'clear' : 'retry';
  action.textContent = hasAssets
    ? ['new', 'following', 'favorites'].includes(exploreTab) ? 'View all tokens' : 'Clear filters'
    : 'Try again';
  if (action.dataset.exploreEmptyAction === 'clear') {
    let revealFrame = 0;
    action.addEventListener('focusin', event => {
      const view = document.defaultView;
      if (!view || event.target !== action) return;
      view.cancelAnimationFrame(revealFrame);
      // Native focus scrolling runs first; preserve the original keyboard owner.
      revealFrame = view.requestAnimationFrame(() => {
        revealFrame = 0;
        if (!action.isConnected || document.activeElement !== action
          || !action.matches(':focus-visible')
          || !document.body?.classList.contains('page-route-explore')) return;
        const visibleChrome = (element, positions) => element?.getClientRects().length
          && view.getComputedStyle(element).visibility !== 'hidden'
          && positions.includes(view.getComputedStyle(element).position);
        const header = document.querySelector('.topbar');
        const nav = document.querySelector('.mobile-workspace-nav');
        const fixedHeader = visibleChrome(header, ['fixed', 'sticky']);
        const fixedNav = visibleChrome(nav, ['fixed']);
        const top = fixedHeader ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
        const bottom = fixedNav ? Math.min(view.innerHeight, nav.getBoundingClientRect().top) : view.innerHeight;
        const rect = action.getBoundingClientRect(), style = view.getComputedStyle(action);
        const outline = style.outlineStyle === 'none' ? 0
          : (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0);
        const delta = fixedHeader && rect.top - outline < top ? rect.top - outline - top
          : fixedNav && rect.bottom + outline > bottom ? rect.bottom + outline - bottom : 0;
        if (delta) view.scrollBy({ top: delta > 0 ? Math.ceil(delta) : Math.floor(delta), left: 0, behavior: 'instant' });
      });
    });
  }
  return action;
}
