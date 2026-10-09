// Dependencies and mutable application state are read live through appState.
export function createHomeFiltersController(appState) {
  // app-source: 497
  function readHomeFilterForm() {
    const ranges = Object.fromEntries(appState.HOME_FILTER_RANGES.map(name => [name, Object.fromEntries(['min', 'max'].map(bound => {
      const raw = appState.homeFilterForm?.querySelector(`[data-home-range="${name}"][data-home-bound="${bound}"]`)?.value;
      return [bound, raw === '' || raw == null ? null : Number(raw)];
    }))]));
    return appState.normalizeHomeLaunchFilters({
      query: document.querySelector('#home-filter-search')?.value || '',
      flags: [...(appState.homeFilterForm?.querySelectorAll('[data-home-filter-flag]:checked') || [])].map(input => input.dataset.homeFilterFlag),
      ranges,
    });
  }
  // app-source-end

  // app-source: 498
  function writeHomeFilterForm(value) {
    const filters = appState.normalizeHomeLaunchFilters(value);
    const search = document.querySelector('#home-filter-search');
    if (search) search.value = filters.query;
    appState.homeFilterForm?.querySelectorAll('[data-home-filter-flag]').forEach(input => {
      input.checked = filters.flags.includes(input.dataset.homeFilterFlag);
    });
    for (const name of appState.HOME_FILTER_RANGES) for (const bound of ['min', 'max']) {
      const input = appState.homeFilterForm?.querySelector(`[data-home-range="${name}"][data-home-bound="${bound}"]`);
      if (input) input.value = filters.ranges[name][bound] ?? '';
    }
  }
  // app-source-end

  // app-source: 499
  function syncHomeFilterIndicator() {
    const count = appState.homeLaunchFilterCount(appState.homeLaunchFilters);
    appState.homeFilterPopup?.toggleAttribute('data-active-filters', count > 0);
    const badge = document.querySelector('#home-filter-active-count');
    if (badge) badge.textContent = String(count);
  }
  // app-source-end

  // app-source: 500
  function applyHomeFilterForm(value) {
    appState.homeLaunchFilters = appState.normalizeHomeLaunchFilters(value);
    appState.homeFrozenOrder = null;
    appState.syncHomeFilterIndicator();
    appState.renderHomeLaunchBoard();
  }
  // app-source-end

  // app-source: 501
  function showHomeFilterView(view) {
    const saved = view === 'saved';
    if (appState.homeFilterForm) appState.homeFilterForm.hidden = saved;
    const savedPanel = document.querySelector('#home-filter-saved');
    if (savedPanel) savedPanel.hidden = !saved;
    document.querySelectorAll('[data-home-filter-view]').forEach(button => {
      const active = button.dataset.homeFilterView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }
  // app-source-end

  // app-source: 502
  function readHomeFilterPresets() {
    try {
      const value = JSON.parse(localStorage.getItem(appState.HOME_FILTER_PRESETS_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string' && item.name.trim())
        .slice(0, 10).map(item => ({ name: item.name.trim().slice(0, 40), filters: appState.normalizeHomeLaunchFilters(item.filters) })) : [];
    } catch { return []; }
  }
  // app-source-end

  // app-source: 503
  function renderHomeFilterPresets() {
    const list = document.querySelector('#home-filter-saved-list');
    if (!list) return;
    const presets = appState.readHomeFilterPresets();
    list.innerHTML = presets.length ? presets.map((item, index) => `<div class="home-filter-preset"><span title="${appState.escapeHtml(item.name)}">${appState.escapeHtml(item.name)}</span><div class="home-filter-preset-actions"><button type="button" data-home-preset-load="${index}" aria-label="Apply ${appState.escapeHtml(item.name)}">Apply</button><button type="button" data-home-preset-delete="${index}" aria-label="Delete ${appState.escapeHtml(item.name)}">×</button></div></div>`).join('')
      : '<p class="home-feed-settings-note">No saved filters yet.</p>';
  }
  // app-source-end

  return { readHomeFilterForm, writeHomeFilterForm, syncHomeFilterIndicator, applyHomeFilterForm, showHomeFilterView, readHomeFilterPresets, renderHomeFilterPresets };
}
