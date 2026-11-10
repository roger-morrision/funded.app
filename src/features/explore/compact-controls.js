// Explore showed tabs, time window, Filters, Sort and Grid/Table in one crowded row.
// Sort and the Grid/Table switch are display preferences, so they move into the
// Filters popover under a "Display" heading. The nodes keep their ids, classes and
// listeners; only their position changes.
export function compactExploreControls(document = globalThis.document) {
  const popover = document.getElementById('explore-filter-popover');
  const sort = document.querySelector('.explore-control-bar .workspace-sort');
  const view = document.querySelector('.explore-control-bar .explore-view-switch');
  if (!popover || (!sort && !view) || popover.querySelector('.explore-display-group')) return false;
  const group = document.createElement('div');
  group.className = 'explore-display-group';
  const heading = document.createElement('p');
  heading.className = 'explore-display-heading';
  heading.textContent = 'Display';
  group.append(heading, ...[sort, view].filter(Boolean));
  const clear = popover.querySelector('.explore-clear');
  if (clear) clear.before(group); else popover.append(group);
  return true;
}

export function mountCompactExploreControls(document = globalThis.document) {
  if (compactExploreControls(document)) return;
  // The control bar is rendered after startup; retry until it exists.
  const observer = new MutationObserver(() => { if (compactExploreControls(document)) observer.disconnect(); });
  observer.observe(document.body, { childList: true, subtree: true });
  globalThis.setTimeout?.(() => observer.disconnect(), 20_000);
}
