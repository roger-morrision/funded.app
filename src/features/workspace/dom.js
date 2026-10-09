export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const text = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
export const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
};
// Moves existing nodes, preserving listeners, IDs, and live data updates.
export function disclose(target, label, { open = false, id } = {}) {
  if (!target || target.parentElement?.classList.contains('ui-disclosure')) return null;
  const details = node('details', 'ui-disclosure');
  if (id) details.id = id;
  details.open = open;
  if (target.parentElement?.classList.contains('main-content')) {
    details.dataset.workspaceRoute = target.matches('.referral-toolkit,.referral-progress-panel') ? 'referrals' : 'overview';
  }
  const summary = node('summary', '', label);
  target.before(details);
  details.append(summary, target);
  return details;
}

export function tabs(root, entries, name) {
  const bar = node('div', 'ui-tabs');
  bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', name);
  const select = (key, focus = false) => {
    entries.forEach(entry => {
      const active = entry.key === key && !entry.button.hidden;
      entry.panel.hidden = !active;
      entry.button.setAttribute('aria-selected', String(active));
      entry.button.tabIndex = active ? 0 : -1;
      if (active && focus) entry.button.focus();
    });
    root.dataset.activeView = key;
  };
  entries.forEach(entry => {
    entry.panel.id ||= `${root.id}-${entry.key}`;
    entry.panel.classList.add('ui-tab-panel');
    entry.panel.setAttribute('role', 'tabpanel');
    entry.panel.tabIndex = 0;
    const button = node('button', '', entry.label);
    button.type = 'button'; button.id = `${entry.panel.id}-tab`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', entry.panel.id);
    entry.panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => select(entry.key));
    entry.button = button; bar.append(button);
  });
  bar.addEventListener('keydown', event => {
    const available = entries.filter(entry => !entry.button.hidden);
    const index = available.findIndex(entry => entry.button === document.activeElement);
    if (index < 0) return;
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + offset + available.length) % available.length;
    if (offset || event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(available[next].key, true); }
  });
  select.setAvailable = (key, available) => {
    const entry = entries.find(item => item.key === key);
    if (!entry) return;
    entry.button.hidden = !available;
    if (!available) {
      entry.panel.hidden = true;
      entry.button.setAttribute('aria-selected', 'false');
      entry.button.tabIndex = -1;
      if (root.dataset.activeView === key) select(entries.find(item => !item.button.hidden)?.key);
    }
  };
  root.prepend(bar); select(entries[0].key);
  return select;
}
