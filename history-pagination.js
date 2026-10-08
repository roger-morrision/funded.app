import { paginateExploreRows } from './explore-pagination.js';

const states = new WeakMap();

// Keep controls outside the list/table so refreshes can replace rows without
// losing keyboard focus or the current page. Identity/filter changes reset it.
export function paginateHistory(container, { label, selector, key = '', pageSize = 10, anchor = container } = {}) {
  if (!container) return;
  let state = states.get(container);
  if (!state) {
    const nav = document.createElement('nav'); nav.className = 'history-pagination';
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = 'Previous';
    const status = document.createElement('span'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next';
    nav.append(previous, status, next);
    state = { page:1, key, nav, previous, next, status };
    previous.addEventListener('click', () => { state.page--; state.render(); });
    next.addEventListener('click', () => { state.page++; state.render(); });
    states.set(container, state);
  }
  if (state.key !== key) { state.page = 1; state.key = key; }
  state.nav.setAttribute('aria-label', `${label} pages`);
  state.previous.setAttribute('aria-label', `Previous ${label.toLowerCase()} page`);
  state.next.setAttribute('aria-label', `Next ${label.toLowerCase()} page`);
  anchor.after(state.nav);
  const items = [...container.querySelectorAll(selector)];
  state.render = () => {
    const result = paginateExploreRows(items, state.page, pageSize);
    state.page = result.page;
    items.forEach((item, index) => { item.classList.add('history-paged-item'); item.hidden = index < result.start || index >= result.end; });
    state.nav.hidden = result.total <= pageSize;
    state.previous.disabled = result.page === 1;
    state.next.disabled = result.page === result.pages;
    state.status.textContent = `${result.total ? result.start + 1 : 0}–${result.end} of ${result.total} · Page ${result.page} of ${result.pages}`;
  };
  state.render();
}
