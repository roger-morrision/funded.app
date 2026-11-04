// The server renders "Name (SYMBOL) | funded.vip" into og:title only for
// registry-verified coins. Reuse it as the header while Solana data loads,
// but only when the page was served for this exact mint.
export function serverCoinIdentity(mintAddress, document = globalThis.document) {
  if (!mintAddress || !document) return null;
  const pageUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
    || document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
  let path = '';
  try { path = new URL(pageUrl, 'https://funded.vip').pathname; } catch { return null; }
  if (path !== `/token/${mintAddress}`) return null;
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const match = /^(.{1,32}) \(([^()]{1,10})\) \| funded\.vip$/.exec(title);
  return match ? { name: match[1], symbol: match[2] } : null;
}
