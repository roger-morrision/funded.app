export function publicCreatorUpdates(updates, now = Date.now()) {
  return (Array.isArray(updates) ? updates : []).filter(row => {
    const time = Date.parse(row.publishAt || row.createdAt);
    return Number.isFinite(time) && time <= now && /^[a-f0-9]{24}$/.test(row.id || '') && typeof row.text === 'string';
  }).sort((a,b) => Date.parse(a.publishAt || a.createdAt) - Date.parse(b.publishAt || b.createdAt));
}
export function upcomingCreatorUpdates(updates, now = Date.now()) {
  return (Array.isArray(updates) ? updates : []).filter(row => /^[a-f0-9]{24}$/.test(row.id || '')
    && Date.parse(row.publishAt) > now).map(row => ({ id:row.id, publishAt:row.publishAt }))
    .sort((a,b) => Date.parse(a.publishAt) - Date.parse(b.publishAt)).slice(0, 20);
}
export function creatorUpdateMutation(profile, input, id, now = Date.now()) {
  const updates = Array.isArray(profile.updates) ? profile.updates : [];
  if (input.cancelId != null) {
    if (!/^[a-f0-9]{24}$/.test(input.cancelId) || !updates.some(row => row.id === input.cancelId && Date.parse(row.publishAt) > now)) throw new Error('Only a pending scheduled update can be cancelled.');
    profile.updates = updates.filter(row => row.id !== input.cancelId); return { cancelled:true, id:input.cancelId };
  }
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 280) throw new Error('Updates must contain 1–280 characters.');
  const publishAt = input.publishAt == null || input.publishAt === '' ? now : Date.parse(input.publishAt);
  if (!Number.isFinite(publishAt) || publishAt < now || publishAt > now + 30 * 86400000) throw new Error('Schedule within the next 30 days, or leave the time empty to publish now.');
  const pending = updates.filter(row => Date.parse(row.publishAt) > now);
  if (publishAt > now && pending.length >= 10) throw new Error('Cancel a scheduled update first (limit 10).');
  const update = { id, text, createdAt:new Date(now).toISOString(), publishAt:new Date(publishAt).toISOString() };
  // Preserve pending announcements when new immediate updates arrive.
  profile.updates = [...publicCreatorUpdates(updates, now).slice(-19), ...pending, update];
  return update;
}
