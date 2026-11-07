let sequence = 0;
// Keep the original controls and listeners: values never diverge across layouts.
export function mountMobileFilterDrawer(toolbar, { title = 'Filters', items, fields }) {
  if (!toolbar) return { sync() {}, setVisible() {} };
  const document = toolbar.ownerDocument;
  const media = window.matchMedia('(max-width: 700px)');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'mobile-filter-toggle';
  const dialog = document.createElement('dialog'); dialog.className = 'mobile-filter-drawer'; dialog.id = `mobile-filters-${++sequence}`;
  dialog.setAttribute('aria-labelledby', `${dialog.id}-title`);
  const heading = document.createElement('h2'); heading.id = `${dialog.id}-title`; heading.textContent = title;
  const body = document.createElement('div'); body.className = 'mobile-filter-fields';
  const done = document.createElement('button'); done.type = 'button'; done.textContent = 'Show results';
  dialog.append(heading, body, done); toolbar.append(button, dialog);
  button.setAttribute('aria-controls', dialog.id); button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  const positions = items.filter(Boolean).map(node => {
    const marker = document.createComment('filter-position'); node.before(marker); return { node, marker };
  });
  const sync = () => {
    const count = fields.filter(({control, empty = ''}) => control && control.value !== empty).length;
    button.textContent = count ? `Filters (${count})` : 'Filters';
  };
  const layout = () => {
    const active = document.activeElement;
    if (!media.matches && dialog.open) dialog.close();
    for (const {node, marker} of positions) { if (media.matches) body.append(node); else marker.after(node); }
    button.hidden = !media.matches;
    if (active && positions.some(({node}) => node.contains(active))) {
      if (media.matches && !dialog.open) button.focus(); else active.focus();
    }
    sync();
  };
  button.addEventListener('click', () => { dialog.showModal(); button.setAttribute('aria-expanded', 'true'); });
  done.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { button.setAttribute('aria-expanded', 'false'); if (media.matches && !button.hidden) button.focus(); });
  toolbar.addEventListener('input', sync); toolbar.addEventListener('change', sync);
  toolbar.addEventListener('click', () => queueMicrotask(sync)); media.addEventListener('change', layout);
  const close = () => { if (dialog.open) dialog.close(); };
  window.addEventListener('hashchange', close); window.addEventListener('funded:route-change', close);
  layout();
  return { sync, setVisible(visible) { if (!visible) close(); } };
}
