import { createHash } from 'node:crypto';

const CHANNELS = new Set(['x', 'telegram', 'whatsapp', 'facebook', 'linkedin', 'reddit', 'social', 'community', 'creator', 'direct']);
const RETENTION_DAYS = 30;

export function cleanShareSource(value) {
  const source = String(value || 'direct').toLowerCase().trim();
  return CHANNELS.has(source) ? source : 'direct';
}

export function pruneShareVisits(visits, now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  let removed = 0;
  for (const [id, visit] of Object.entries(visits || {})) {
    const day = Date.parse(`${visit.day}T00:00:00Z`);
    if (!Number.isFinite(day) || day < cutoff) { delete visits[id]; removed += 1; }
  }
  return removed;
}

export function recordShareVisit(visits, { code, visitorId, source, now = Date.now() }) {
  if (!/^[a-zA-Z0-9_-]{4,32}$/.test(String(code || '')) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(visitorId || ''))) throw new Error('A valid referral code and opt-in browser ID are required.');
  const day = new Date(now).toISOString().slice(0, 10);
  const visitor = createHash('sha256').update(`${code}:${visitorId}`).digest('hex');
  const key = `${code}:${visitor}:${day}`;
  pruneShareVisits(visits, now);
  if (!visits[key]) visits[key] = { code, visitor, source:cleanShareSource(source), day };
  return visits[key];
}

export function summarizeShareVisits(visits, code, now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  const rows = Object.values(visits || {}).filter(item => item.code === code && Date.parse(`${item.day}T00:00:00Z`) >= cutoff);
  const browsers = new Map();
  const channels = {};
  for (const row of rows) {
    const days = browsers.get(row.visitor) || new Set();
    days.add(row.day); browsers.set(row.visitor, days);
    channels[row.source] = (channels[row.source] || 0) + 1;
  }
  return { consentedVisitDays: rows.length, consentedBrowsers: browsers.size,
    returningBrowsers: [...browsers.values()].filter(days => days.size > 1).length, byChannel: channels,
    windowDays: RETENTION_DAYS };
}
