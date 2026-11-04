const KEY = 'funded.explore-return.v1';
export function mountExploreReturn() {
  const root = document.querySelector('#explore'); if (!root) return;
  root.addEventListener('click', event => {
    const anchor = event.target.closest('a[href]'); if (!anchor) return;
    const url = new URL(anchor.href, location.origin), mint = url.pathname.match(/^\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1];
    if (!mint || event.ctrlKey || event.metaKey || event.shiftKey || event.button) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({mint, y:scrollY, at:Date.now()})); } catch {}
  });
  const restore = () => {
    if (!document.body.classList.contains('page-route-explore')) return;
    let saved; try { saved=JSON.parse(sessionStorage.getItem(KEY)||'null'); } catch { return; }
    if (!saved || Date.now()-saved.at>3600000 || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(saved.mint)) return;
    const anchor = [...root.querySelectorAll('a[href]')].find(a => new URL(a.href).pathname === `/token/${saved.mint}` && a.getClientRects().length);
    if (!anchor) return;
    try { sessionStorage.removeItem(KEY); } catch {}
    anchor.focus({preventScroll:true}); scrollTo({top:Math.max(0,Number(saved.y)||0),behavior:'instant'});
    if (anchor.getBoundingClientRect().bottom > innerHeight || anchor.getBoundingClientRect().top < 75) anchor.scrollIntoView({block:'center'});
  };
  document.addEventListener('funded:verified-search-index', () => requestAnimationFrame(restore));
  window.addEventListener('funded:route-change', () => requestAnimationFrame(restore));
  requestAnimationFrame(restore);
}
