const LINK_RULES = {
  website: { label: 'Website' },
  x: { label: 'X link', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'] },
  telegram: { label: 'Telegram link', hosts: ['t.me', 'telegram.me'] },
  discord: { label: 'Discord link', hosts: ['discord.gg', 'discord.com', 'www.discord.com'] },
};

export function canonicalLaunchSocialUrl(value, kind) {
  const rule = LINK_RULES[kind];
  if (!rule) throw new Error('Unknown launch link.');
  if (typeof value !== 'string' || value.length > 300) throw new Error(`${rule.label} is invalid or too long.`);
  const raw = value.trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${rule.label} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (rule.hosts && !rule.hosts.includes(parsed.hostname.toLowerCase()))) {
    throw new Error(`${rule.label} must be a valid HTTPS URL.`);
  }
  return parsed.href;
}

export function normalizeXProfileInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(raw)) return `https://x.com/${raw.replace(/^@/, '')}`;
  const candidate = /^(?:www\.)?(?:x\.com|twitter\.com)(?:[/?#]|$)/i.test(raw) ? `https://${raw}` : raw;
  let parsed;
  try { parsed = new URL(candidate); } catch { return raw; }
  if (!LINK_RULES.x.hosts.includes(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) return raw;
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';
  return parsed.protocol === 'https:' ? parsed.href : raw;
}
