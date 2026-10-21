const RECORDS = new Set(['trades','payments','claims','holders']);
let revealFrame = 0;
let stopWatching = () => {};

// Use the existing tab click/render pathway for explicit shortcuts and tab keys.
export function openCoinRecord(key, {document = globalThis.document, initiatingEvent} = {}) {
  if (!RECORDS.has(key)) return false;
  const tab = document.querySelector(`#coin-page .coin-tabs [data-coin-tab="${key}"]`);
  if (!tab || !tab.getClientRects().length || tab.closest('[hidden]')) return false;
  stopWatching();
  tab.click();
  tab.focus({preventScroll:true});
  const view = document.defaultView;
  const controller = new view.AbortController();
  let observer;
  const stop = () => {
    controller.abort();
    observer?.disconnect();
    view.cancelAnimationFrame(revealFrame);
    revealFrame = 0;
  };
  stopWatching = stop;
  const reveal = () => {
    revealFrame = 0;
    if (document.activeElement !== tab || !tab.isConnected || !tab.getClientRects().length) { stop(); return; }
    // Instant nearest alignment works for reduced motion and nested scrollers.
    tab.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    const strip = tab.closest('.coin-tabs');
    const style = view.getComputedStyle(tab);
    const outline = (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0);
    let box = tab.getBoundingClientRect();
    const left = strip.getBoundingClientRect().left + strip.clientLeft, right = left + strip.clientWidth;
    const horizontal = box.left - outline < left ? box.left - outline - left
      : box.right + outline > right ? box.right + outline - right : 0;
    const rounded = delta => delta > 0 ? Math.ceil(delta) : Math.floor(delta);
    if (horizontal) strip.scrollBy({left:rounded(horizontal),top:0,behavior:'instant'});
    const header = document.querySelector('.topbar'), nav = document.querySelector('.mobile-workspace-nav');
    const top = header?.getClientRects().length ? Math.max(0,header.getBoundingClientRect().bottom) : 0;
    const bottom = nav?.getClientRects().length ? Math.min(view.innerHeight,nav.getBoundingClientRect().top) : view.innerHeight;
    box = tab.getBoundingClientRect();
    const vertical = box.top - outline < top ? box.top - outline - top
      : box.bottom + outline > bottom ? box.bottom + outline - bottom : 0;
    let scroller = strip.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1
      && /auto|scroll/.test(view.getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    // Even a zero-distance instant scroll cancels a pending native focus scroll.
    // Read the current geometry above; never restore a captured scroll position.
    (scroller || view).scrollBy({top:rounded(vertical),left:0,behavior:'instant'});
  };
  const schedule = () => {
    view.cancelAnimationFrame(revealFrame);
    revealFrame = view.requestAnimationFrame(reveal);
  };
  // Loading token details can move the tab after the first reveal. Follow only
  // this explicit focus owner, using fresh geometry and no focus calls.
  observer = new view.ResizeObserver(schedule);
  observer.observe(tab.closest('#coin-page'));
  observer.observe(tab.closest('.coin-tabs'));
  document.addEventListener('focusin', () => { if (document.activeElement !== tab) stop(); }, {signal:controller.signal});
  for (const event of ['pointerdown','wheel','touchstart','keydown'])
    document.addEventListener(event, input => {
      // The key that created this focus owner is still bubbling to document.
      // Later user input cancels it, including the next native tab movement.
      if (input !== initiatingEvent) stop();
    }, {signal:controller.signal,passive:true});
  view.addEventListener('resize', schedule, {signal:controller.signal});
  schedule();
  return true;
}
