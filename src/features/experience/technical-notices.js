// Technical status lines (RPC, verification, stale data, failures) stay out of
// page copy. They are hidden where they render and summarized in one notice.
const WARNING = /\b(unavailable|could not|couldn't|failed|failure|not verified|unverified|verification (?:pending|unavailable|incomplete)|incomplete|stale|rate.?limit(?:ed)?|RPC|provider|retry shortly|try again shortly|partial coverage|awaiting (?:receipt|verified|verification)|current verification pending|no amount is confirmed|busy)\b/i;
const NETWORK = /\b(RPC|rate.?limit(?:ed)?|provider|retry|busy|network|connection)\b/i;
const ERROR = /\b(failed|rejected|error|insufficient|declined)\b/i;
const VALUE_CELLS = 'strong, b, dd';
const CANDIDATES = `p, small, em, span, li, div, [role="status"], ${VALUE_CELLS}`;
const VALUE = 'data-technical-value';
const VALUE_STYLE = { 'font-size': '0' };
const VISUALLY_HIDDEN = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0',
  overflow: 'hidden', 'clip-path': 'inset(50%)', 'white-space': 'nowrap', border: '0' };
const SKIP = 'h1, h2, h3, h4, button, a, label, input, select, textarea, summary, option, dialog, kbd, code, [contenteditable], [id$="-error"], .field-error, [role="alert"], #docs, #privacy, #terms, #disclosures, #opt-out, .technical-notice';
const JARGON_SKIP = 'input, textarea, select, option, code, kbd, [contenteditable], .workspace-network, #docs, #privacy, #terms, #disclosures, #opt-out';
const HIDDEN = 'data-technical-notice';
const INLINE = 'i, b, strong, em, span, abbr, time, wbr, br';
// A status line is a leaf, or a short text element whose children are only
// inline formatting (no links, buttons or nested blocks).
const plainLine = element => !element.childElementCount
  || (!element.matches('div, [role="status"]') && [...element.children].every(child => child.matches(INLINE) && !child.childElementCount));
const DISMISS_MS = 10 * 60_000;
const COMPACT_AFTER_MS = 8_000;
const COPY = {
  network: { title: 'Solana data is loading slowly', body: 'Some live numbers may be missing for a moment. We keep retrying automatically.' },
  verification: { title: 'Some figures are still being verified', body: 'They appear here once they are confirmed on Solana.' },
};

// Display-only wording: records, APIs and receipts keep their exact terms.
const PLAIN_WORDS = [
  [/\bV3 router\b/g, 'fee router'], [/\bV3 (?=settlement|fee|router|claim)/g, ''],
  [/\bfinalized\b/g, 'confirmed'], [/\bFinalized\b/g, 'Confirmed'],
  [/\bkeeper\b/g, 'automation'], [/\bKeeper\b/g, 'Automation'],
  [/\bindexed\b/g, 'recorded'], [/\bIndexed\b/g, 'Recorded'],
  [/\bworker(?=[ -]recorded| snapshots?\b)/g, 'automation'],
  [/\bSolana RPC\b/g, 'Solana network'], [/\bRPC\b/g, 'network'],
  // The network is shown once, in the top label; page copy does not repeat it.
  [/\s*·\s*Devnet QA\b/g, ''], [/\bDevnet QA\b/g, 'QA'], [/\s+(?:on|for) (?:Solana )?Devnet\b/g, ''],
  [/\bSolana Devnet\b/g, 'Solana'], [/\s*\(Devnet\)/g, ''], [/\bDevnet\s+(?=[a-z])/g, ''], [/\bDevnet\s+(?=[A-Z])/g, ''],
];

export function plainWording(text) {
  return PLAIN_WORDS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), String(text));
}

export function classifyTechnicalText(text, { valueCell = false } = {}) {
  const value = String(text || '').trim();
  if (value.length < (valueCell ? 8 : 14) || value.length > 240 || !WARNING.test(value)) return null;
  if (ERROR.test(value)) return 'error';
  return NETWORK.test(value) ? 'network' : 'verification';
}

export function mountTechnicalNotices({ document = globalThis.document, root = document?.querySelector('#main-content') } = {}) {
  if (!document || !root) return null;
  const view = document.defaultView;
  const store = view?.sessionStorage;
  const dismissedUntil = category => { try { return Number(store?.getItem(`funded.notice.${category}`)) || 0; } catch { return 0; } };
  const dismiss = category => { try { store?.setItem(`funded.notice.${category}`, String(Date.now() + DISMISS_MS)); } catch {} };
  const shownErrors = new Set();

  const host = document.createElement('div');
  host.className = 'technical-notice-stack';
  document.body.append(host);

  const panel = document.createElement('section');
  panel.className = 'technical-notice';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  host.append(panel);
  // Phones show the summary inline under the topbar so it never covers coin
  // cards or the trade bar; error alerts keep floating.
  const slot = document.createElement('div');
  slot.className = 'technical-notice-inline';
  const phone = view?.matchMedia?.('(max-width: 700px)');
  const place = () => {
    if (!phone?.matches) { host.append(panel); slot.remove(); return; }
    const topbar = root.querySelector(':scope > .topbar');
    if (topbar) topbar.after(slot); else root.prepend(slot);
    slot.append(panel);
  };
  place();
  phone?.addEventListener?.('change', place);

  let category = null, shownKey = '', compactTimer = 0;
  // The summary shrinks to a small pill after a few seconds so it stops
  // covering page controls; selecting the pill expands it again.
  // Phones start with the pill: the full card would sit over the content and
  // the trade bar, which leaves little room on a small screen.
  const compactLater = () => {
    view?.clearTimeout(compactTimer);
    if (view?.matchMedia?.('(max-width: 700px)').matches) { panel.classList.add('is-compact'); return; }
    compactTimer = view?.setTimeout(() => panel.classList.add('is-compact'), COMPACT_AFTER_MS);
  };
  function renderSummary(groups) {
    const next = ['network', 'verification'].find(key => groups[key].size && dismissedUntil(key) < Date.now()) || null;
    if (!next) { category = null; shownKey = ''; panel.hidden = true; return; }
    const details = [...groups[next]].slice(0, 5);
    const key = [next, ...details].join('\n');
    if (key === shownKey && !panel.hidden) return;
    if (next !== category || panel.hidden) { panel.classList.remove('is-compact'); compactLater(); }
    category = next; shownKey = key;
    panel.replaceChildren();
    const head = document.createElement('div'); head.className = 'technical-notice-head';
    const title = document.createElement('button'); title.type = 'button'; title.className = 'technical-notice-title';
    title.textContent = COPY[next].title;
    title.addEventListener('click', () => {
      panel.classList.remove('is-compact');
      view?.clearTimeout(compactTimer);
      compactTimer = view?.setTimeout(() => panel.classList.add('is-compact'), COMPACT_AFTER_MS);
    });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'technical-notice-close';
    close.setAttribute('aria-label', 'Dismiss notice'); close.textContent = '×';
    close.addEventListener('click', () => { dismiss(category); shownKey = ''; panel.hidden = true; });
    head.append(title, close);
    const body = document.createElement('p'); body.textContent = COPY[next].body;
    const more = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Details';
    const list = document.createElement('ul');
    for (const line of details) { const item = document.createElement('li'); item.textContent = line; list.append(item); }
    more.append(summary, list);
    panel.append(head, body, more);
    panel.hidden = false;
  }

  function showError(text) {
    if (shownErrors.has(text)) return;
    shownErrors.add(text);
    const toast = document.createElement('section');
    toast.className = 'technical-notice technical-notice-error';
    toast.setAttribute('role', 'alert');
    const head = document.createElement('div'); head.className = 'technical-notice-head';
    const title = document.createElement('strong'); title.textContent = 'Something went wrong';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'technical-notice-close';
    close.setAttribute('aria-label', 'Dismiss alert'); close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    head.append(title, close);
    const body = document.createElement('p'); body.textContent = text;
    toast.append(head, body);
    host.prepend(toast);
    view?.setTimeout(() => toast.remove(), 10_000);
  }

  function rewordJargon() {
    const walker = document.createTreeWalker(root, view.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(JARGON_SKIP) || parent.closest('[data-inline-status]')) continue;
      const plain = plainWording(node.nodeValue);
      if (plain !== node.nodeValue) node.nodeValue = plain;
    }
  }

  function restore(element) {
    element.removeAttribute(HIDDEN); element.removeAttribute(VALUE);
    for (const property of new Set([...Object.keys(VALUE_STYLE), ...Object.keys(VISUALLY_HIDDEN)])) element.style.removeProperty(property);
    element.style.removeProperty('--fv-cell-size');
  }

  function scan() {
    rewordJargon();
    const groups = { network: new Set(), verification: new Set() };
    // A hidden line that has since been replaced with real content (or no
    // longer reads as a status line) comes back into view.
    for (const element of root.querySelectorAll(`[${HIDDEN}]`)) {
      if (!plainLine(element) || element.closest(SKIP) || element.closest('[data-inline-status]')) restore(element);
    }
    for (const element of root.querySelectorAll(CANDIDATES)) {
      if (!plainLine(element) || element.closest(SKIP) || element.closest('[data-inline-status]')) continue;
      // Value cells keep their place and read as "Updating…"; other lines are
      // removed visually but stay available to screen readers. Inline styles
      // outrank the page's route-specific layout rules.
      const valueCell = element.matches(VALUE_CELLS);
      const kind = classifyTechnicalText(element.textContent, { valueCell });
      const styles = valueCell ? VALUE_STYLE : VISUALLY_HIDDEN;
      if (!kind) {
        if (element.hasAttribute(HIDDEN)) restore(element);
        continue;
      }
      element.setAttribute(HIDDEN, kind);
      // "Updating…" keeps the cell's own text size so the layout does not shift.
      if (valueCell && !element.hasAttribute(VALUE)) element.style.setProperty('--fv-cell-size', view.getComputedStyle(element).fontSize);
      if (valueCell) element.setAttribute(VALUE, '');
      for (const [property, value] of Object.entries(styles)) element.style.setProperty(property, value);
      // Only report lines from the part of the page the visitor is on.
      if (!element.parentElement || element.parentElement.offsetParent === null) continue;
      const text = element.textContent.trim();
      if (kind === 'error') showError(text);
      else groups[kind].add(text);
    }
    // Figure groups that would show only "—" placeholders stay out of view.
    for (const group of root.querySelectorAll('[data-hide-when-empty]')) {
      const empty = ![...group.querySelectorAll('strong')].some(value => /\d/.test(value.textContent));
      if (empty) group.style.setProperty('display', 'none'); else group.style.removeProperty('display');
    }
    renderSummary(groups);
  }

  let timer = 0;
  const schedule = () => { view?.clearTimeout(timer); timer = view?.setTimeout(scan, 300); };
  // Content replacing a hidden status line shows at once, not after the
  // debounced rescan.
  const observer = new view.MutationObserver(mutations => {
    for (const { target } of mutations) {
      const element = target.nodeType === 1 ? target : target.parentElement;
      if (element?.hasAttribute(HIDDEN) && !plainLine(element)) restore(element);
    }
    schedule();
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  view?.addEventListener('hashchange', schedule);
  scan();
  return { scan, disconnect: () => { observer.disconnect(); phone?.removeEventListener?.('change', place); host.remove(); slot.remove(); } };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountTechnicalNotices(), { once: true });
  else mountTechnicalNotices();
}
