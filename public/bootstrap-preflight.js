// The bare app URL opens Home for every visitor. About remains available at
// /welcome; deep links and referral/receipt parameters keep their normal routes.

try {
  if (localStorage.getItem('funded.desktop-sidebar-collapsed') === 'true') {
    document.documentElement.classList.add('sidebar-collapsed');
  }
} catch {}

(() => {
  const showStartupFailure = () => {
    if (document.documentElement.dataset.bootstrapEntryFailed !== 'true' || document.body?.dataset.bootstrapState !== 'loading') return;
    const message = document.querySelector('[data-bootstrap-message]');
    if (!message) return;
    document.body.dataset.bootstrapState = 'failed';
    message.textContent = 'The app could not finish loading. Check your connection and reload to try again.';
  };
  window.addEventListener('error', event => {
    const script = event.target;
    if (!(script instanceof HTMLScriptElement) || script.type !== 'module') return;
    const url = new URL(script.src, location.href);
    if (url.origin !== location.origin || (!['/bootstrap-entry.js', '/bootstrap-gate.js', '/bootstrap.js'].includes(url.pathname) && !url.pathname.startsWith('/assets/'))) return;
    if (['ready', 'degraded'].includes(document.body?.dataset.bootstrapState)) return;
    document.documentElement.dataset.bootstrapEntryFailed = 'true';
    showStartupFailure();
  }, true);
  document.addEventListener('DOMContentLoaded', showStartupFailure, { once: true });
  document.addEventListener('funded:bootstrap-failed', showStartupFailure);
  window.setTimeout(() => {
    if (document.body?.dataset.bootstrapState !== 'loading') return;
    const message = document.querySelector('[data-bootstrap-message]');
    if (message) message.textContent = 'Still loading. You can wait or reload to try again.';
  }, 10_000);
})();

// Deep links (#explore, /token/…, /wallet/…) start hidden until the router has
// switched to the requested page, so the server's Home markup never flashes first.
try {
  const hash = location.hash.replace(/^#/, '').split(/[/?]/)[0];
  if ((hash && hash !== 'overview') || (location.pathname !== '/' && location.pathname !== '/explore')) {
    document.documentElement.classList.add('route-booting');
    setTimeout(() => document.documentElement.classList.remove('route-booting'), 4000);
  }
} catch {}
try {
  if (document.documentElement.classList.contains('route-booting')) {
    // Reveal the page once the requested route is shown, the app reports ready, and
    // startup modules have stopped rearranging the page for 120 ms (at most 1 s
    // after ready), so the visitor never sees sections jump into place.
    let lastChange = performance.now(), readyAt = 0, timer = 0;
    // Only structural changes count; values filling into existing elements do not move sections.
    const structural = list => list.some(m => m.type === 'attributes' || [...m.addedNodes, ...m.removedNodes].some(node => node.nodeType === 1));
    const observer = new MutationObserver(list => { if (structural(list)) lastChange = performance.now(); });
    const release = () => { document.documentElement.classList.remove('route-booting'); observer.disconnect(); clearInterval(timer); };
    const check = () => {
      if (!document.documentElement.classList.contains('route-booting')) { release(); return; }
      // Wait for the requested page itself; the router may pass through Home first.
      const routed = document.body && [...document.body.classList].some(name => name.startsWith('page-route-') && name !== 'page-route-overview');
      const ready = ['ready', 'degraded'].includes(document.body?.dataset.bootstrapState);
      if (!routed || !ready) return;
      readyAt ||= performance.now();
      if (performance.now() - lastChange >= 120 || performance.now() - readyAt >= 1000) release();
    };
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
      timer = setInterval(check, 50);
      check();
    }, { once: true });
  }
} catch {}
