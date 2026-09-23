import { validXId } from '../creator-support-model.js';

export function followingWindow(ids, after = '') {
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || !validXId(id))) throw new Error('Choose up to 200 valid followed creators.');
  const sorted = [...new Set(ids)].sort();
  if (after && (!validXId(after) || !sorted.includes(after))) throw new Error('Following changed. Start again from the first page.');
  const remaining = sorted.filter(id => id > after), selected = remaining.slice(0, 20);
  return { selected, requestedCount: sorted.length, checkedCount: selected.length, limit: 20,
    nextCursor: remaining.length > 20 ? selected.at(-1) : null };
}

export function followingUpdatesPage(directory, profiles, ids, after = '') {
  const { selected, ...page } = followingWindow(ids, after);
  return { ...page, creators: directory.filter(row => selected.includes(row.id) && !profiles[row.id]?.optedOut).map(row => ({
    id: row.id, handle: row.handle, name: row.name, identityVerified: row.identityVerified,
    updates: profiles[row.id]?.identityVerified === true ? (Array.isArray(profiles[row.id].updates) ? profiles[row.id].updates : [])
      .slice(-2).reverse().filter(update => /^[a-f0-9]{24}$/.test(update?.id) && typeof update.text === 'string')
      .map(update => ({ id: update.id, text: update.text.slice(0, 280), createdAt: String(update.createdAt || '').slice(0, 40) })) : [],
  })).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
