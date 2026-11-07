// Common active-filter controls. Values remain in the mounted page on route changes.
// No wallet searches or transaction addresses are persisted to browser storage.
export function mountFilterChips(root, fields, { reset, onChange = () => {} } = {}) {
  if (!root) return () => {};
  const bar = document.createElement('div'); bar.className = 'filter-chips';
  bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Active filters');
  root.after(bar);
  function render() {
    const focused = bar.contains(document.activeElement);
    const focusedKey = focused ? document.activeElement.dataset.filterKey : null;
    const items = fields.filter(field => field.control && field.control.value !== (field.empty ?? ''));
    bar.hidden = !items.length;
    bar.replaceChildren();
    for (const field of items) {
      const control = field.control, button = document.createElement('button'); button.type = 'button';
      const value = control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent : control.value;
      button.textContent = `${field.label}: ${value} ×`; button.dataset.filterKey = field.label;
      button.setAttribute('aria-label', `Remove ${field.label} filter: ${value}`);
      button.addEventListener('click', () => { control.value = field.empty ?? ''; control.dispatchEvent(new Event('input', {bubbles:true})); control.dispatchEvent(new Event('change', {bubbles:true})); render(); onChange(); });
      bar.append(button);
    }
    if (items.length > 1 && reset) {
      const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear filters'; clear.dataset.filterKey = 'clear';
      clear.addEventListener('click', () => { reset(); render(); onChange(); }); bar.append(clear);
    }
    if (focused) ([...bar.children].find(button => button.dataset.filterKey === focusedKey) || bar.firstElementChild || fields[0]?.control)?.focus({preventScroll:true});
  }
  root.addEventListener('input', render); root.addEventListener('change', render);
  // Reset buttons may update values without dispatching a change event.
  root.addEventListener('click', () => queueMicrotask(render));
  render(); return render;
}
