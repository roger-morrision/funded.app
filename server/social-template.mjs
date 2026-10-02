// The app shell has generic preview tags for root invite links. Route pages
// replace them with verified token or creator metadata before serving HTML.
export function withoutDefaultSocialTags(template) {
  return template
    .replace(/^\s*<meta property="og:(?:type|title|description)"[^\n]*\r?\n/gm, '')
    .replace(/^\s*<meta name="twitter:card"[^\n]*\r?\n/gm, '');
}
