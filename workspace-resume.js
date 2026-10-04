import { exploreFilterUrl } from './explore-filter-url.js';
const pendingStates = new Set(['broadcasting', 'submitted', 'unknown', 'confirmed', 'verification-pending', 'registration-pending']);

// These are device records and navigation choices, never financial proof.
export function workspaceResumeItems({ draft, journal = [], searches = [], cluster, origin }) {
  const items = [];
  const unfinished = Array.isArray(journal) ? journal.filter(row => row?.cluster === cluster && pendingStates.has(row.state)) : [];
  if (unfinished.length) items.push({ kind: 'recovery', label: `Review ${unfinished.length === 1 ? 'unfinished launch' : `${unfinished.length} unfinished launches`}`, href: '#my-launches', detail: 'Check the saved receipt before retrying a launch.' });
  if (draft) items.push({ kind: 'draft', label: 'Resume saved draft', href: '#launch', detail: 'Review your device draft before restoring it.' });
  if (Array.isArray(searches)) {
    for (const row of searches.filter(row => row && typeof row.name === 'string' && row.name.trim() && row.name.length <= 60 && row.filters && typeof row.filters === 'object' && !Array.isArray(row.filters)).slice(0, 3)) {
      items.push({ kind: 'search', label: row.name.trim(), href: exploreFilterUrl(origin, row.filters), detail: 'Saved search on this device' });
    }
  }
  return items;
}
