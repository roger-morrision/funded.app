const SOCIAL_SOURCES = [
  ['website', 'Website', ['website']],
  ['socialX', 'X', ['twitter', 'x']],
  ['telegram', 'Telegram', ['telegram']],
  ['discord', 'Discord', ['discord']],
];

function publicSocialUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function exploreSocialLinks(record = {}, verifiedLaunch = {}) {
  return SOCIAL_SOURCES.flatMap(([icon, label, fields]) => {
    const href = [record, verifiedLaunch].flatMap(source => fields.map(field => source?.[field]))
      .map(publicSocialUrl).find(Boolean);
    return href ? [{ icon, label, href }] : [];
  });
}
