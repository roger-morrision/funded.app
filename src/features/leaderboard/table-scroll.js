// Show scroll guidance only when the rendered table has more columns.
export function initializeLeaderboardScroll(document = globalThis.document) {
  const table = document.querySelector('#leaderboard-table');
  if (!table || document.querySelector('#leaderboard-scroll-help')) return;
  const hint = document.createElement('p');
  hint.id = 'leaderboard-scroll-help'; hint.className = 'leaderboard-scroll-hint'; hint.hidden = true;
  hint.textContent = 'More columns → Swipe, or use the Left and Right arrow keys.';
  table.after(hint);
  const update = () => {
    const overflow = table.clientWidth > 0 && table.scrollWidth > table.clientWidth + 1;
    hint.hidden = !overflow;
    // Keep the existing table stop and refresh focus recovery behavior.
    table.tabIndex = 0;
    const describedBy = (table.getAttribute('aria-describedby') || '').split(/\s+/)
      .filter(id => id && id !== hint.id);
    if (overflow) describedBy.push(hint.id);
    if (describedBy.length) table.setAttribute('aria-describedby', describedBy.join(' '));
    else table.removeAttribute('aria-describedby');
  };
  const view = document.defaultView;
  const resize = view?.ResizeObserver ? new view.ResizeObserver(update) : null;
  const observe = () => {
    resize?.disconnect(); resize?.observe(table);
    const header = table.querySelector('.leaderboard-table-head');
    if (header) resize?.observe(header);
    update();
  };
  const changes = new view.MutationObserver(observe);
  changes.observe(table, {childList:true, subtree:true, attributes:true, attributeFilter:['data-view']});
  if (!resize) view.addEventListener('resize', update);
  observe();
  return () => { changes.disconnect(); resize?.disconnect(); view.removeEventListener('resize', update); hint.remove(); };
}
