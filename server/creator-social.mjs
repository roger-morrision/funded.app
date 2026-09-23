import { buildCreatorSupport } from './creator-support.mjs';
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Server-rendered text metadata for crawlers; no unverified earnings or endorsement.
// No request Host is reflected into metadata, and opted-out profiles stay private.
export function creatorPageHtml(template, state, id, cluster) {
  const creator = buildCreatorSupport(state, id, null, cluster);
  const title = creator ? `Support ${creator.handle} | funded.vip (${cluster})` : 'Creator page unavailable | funded.vip';
  const description = creator ? 'Explore creator-fee policies and matched payout receipts. Fan-created coins are not endorsements. Tokens can lose all value.' : 'This creator page is unavailable or excluded from discovery.';
  let image='';try{const origin=new URL(process.env.PUBLIC_APP_URL);if(['https:','http:'].includes(origin.protocol)&&!origin.username&&!origin.password)image=new URL(`/api/creators/${id}/card.png`,origin.origin).href;}catch{}
  const metadata = `<meta property="og:type" content="website" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta name="twitter:card" content="${creator&&image?'summary_large_image':'summary'}" />${creator&&image?`<meta property="og:image" content="${escapeHtml(image)}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />`:''}${creator ? '' : '<meta name="robots" content="noindex" />'}`;
  return template.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace('</head>', `${metadata}</head>`);
}
