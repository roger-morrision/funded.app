// Static HTML is already inert before this module or its dependencies arrive.
// This gate drops premature input; it never saves or replays a user action.
const banner = document.querySelector('#bootstrap-status');
const message = banner.querySelector('[data-bootstrap-message]');
let pending = document.body.dataset.bootstrapState === 'loading';
let failed = document.body.dataset.bootstrapState === 'failed';

function guardRoot(element) {
  if (!(element instanceof HTMLElement) || element === banner
    || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName) || element.inert) return;
  element.inert = true;
  element.setAttribute('data-bootstrap-inert', '');
}
for (const element of document.body.children) guardRoot(element);
const observer = new MutationObserver(records => {
  if (pending) for (const record of records) for (const element of record.addedNodes) guardRoot(element);
});
observer.observe(document.body, { childList: true });

const events = ['click', 'dblclick', 'pointerdown', 'keydown', 'submit', 'beforeinput'];
function blockEarlyInput(event) {
  if (!pending || !event.isTrusted || banner.contains(event.target)) return;
  if (event.type === 'keydown'
    && (!['Enter', ' '].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
for (const type of events) document.addEventListener(type, blockEarlyInput, true);

export function appReady() {
  if (failed || document.body.dataset.bootstrapState === 'failed'
    || document.documentElement.dataset.bootstrapEntryFailed === 'true' || !pending) return;
  pending = false;
  observer.disconnect();
  for (const type of events) document.removeEventListener(type, blockEarlyInput, true);
  // Do not enable financially disabled controls or touch inert owned by a modal.
  for (const element of document.querySelectorAll('[data-bootstrap-inert]')) {
    element.inert = false;
    element.removeAttribute('data-bootstrap-inert');
  }
  document.querySelector('.app-shell')?.setAttribute('aria-busy', 'false');
  document.body.dataset.bootstrapState = 'ready';
  const recoveryFocused = banner.contains(document.activeElement);
  banner.hidden = true;
  if (recoveryFocused) document.querySelector('#main-content')?.focus({ preventScroll: true });
}

export function appFailed() {
  failed = true;
  document.body.dataset.bootstrapState = 'failed';
  message.textContent = 'The app could not finish loading. Check your connection and reload to try again.';
  banner.hidden = false;
}

export function optionalFeatureFailed() {
  if (failed || pending) return;
  document.body.dataset.bootstrapState = 'degraded';
  message.textContent = 'Some features could not load. The core app is available. Reload to restore the missing features.';
  banner.hidden = false;
}
