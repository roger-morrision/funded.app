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
