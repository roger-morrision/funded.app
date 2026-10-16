const START = '<!-- public-discovery-items:start -->';
const END = '<!-- public-discovery-items:end -->';
const escapeHtml = value => String(value).replace(/[&<>"']/g,
  char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

export function publicDiscoveryHtml(template, launches, cluster) {
  const start = template.indexOf(START);
  const end = template.indexOf(END, start + START.length);
  if (start < 0 || end < 0) return template;
  const items = (Array.isArray(launches) ? launches : [])
    .filter(item => item?.onchainVerified === true && item.cluster === cluster
      && item.pumpFeeRoute?.scope === 'per-mint-v3' && item.pumpFeeRoute.verified === true
      && item.pumpFeeRoute.router === item.creator && item.pumpFeeRoute.programId
      && item.policySignature && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(item.mint || ''))
      && String(item.name || '').trim() && String(item.symbol || '').trim())
    .sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0))
    .slice(0, 6);
  const content = items.length
    ? `<ul class="public-discovery-list">${items.map(item => `<li><a href="/token/${item.mint}"><strong>${escapeHtml(String(item.name).slice(0, 32))}</strong><span>${escapeHtml(String(item.symbol).slice(0, 10))}</span><code>${item.mint.slice(0, 4)}…${item.mint.slice(-4)}</code></a></li>`).join('')}</ul>`
    : `<p class="public-discovery-empty">${launches === null ? 'Launch directory is temporarily unavailable.' : 'No verified launches to show right now.'} Browse the directory for the current status.</p>`;
  return template.slice(0, start) + content + template.slice(end + END.length);
}
