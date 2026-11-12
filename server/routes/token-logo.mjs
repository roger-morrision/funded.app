// Same-origin token logo for share banners. Logo hosts (DexScreener, IPFS
// gateways) rarely send CORS headers, so a canvas that draws them directly
// becomes tainted and cannot be downloaded or shared. Only the logo URL found in
// our own indexed market data is fetched; the caller cannot supply a URL.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BYTES = 2_000_000;

export function createTokenLogoRoute({ free, tokenCache, fetchImpl = fetch, ttlMs = 6 * 60 * 60_000 }) {
  const cache = new Map();
  async function logoUrl(mint) {
    const cached = (await tokenCache?.read([mint]).catch(() => new Map()))?.get(mint);
    const dex = cached?.imageUri ? null : (await free.dexTokens([mint]).catch(() => new Map())).get(mint);
    let url = cached?.imageUri || dex?.imageUri || null;
    if (!url) url = (await free.jupToken(mint).catch(() => null))?.icon || null;
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  }
  async function load(mint) {
    const url = await logoUrl(mint);
    if (!url) return null;
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { accept: 'image/*' } });
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim();
    if (!response.ok || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? { type, bytes } : null;
  }
  return async function handleTokenLogo(req, res, url) {
    const match = req.method === 'GET' && /^\/api\/tokens\/([^/]+)\/logo$/.exec(url.pathname);
    if (!match) return false;
    const mint = decodeURIComponent(match[1]);
    if (!MINT.test(mint)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"A valid token mint is required."}'); return true; }
    let hit = cache.get(mint);
    if (!hit || hit.expiresAt < Date.now()) {
      const image = await load(mint).catch(() => null);
      hit = { image, expiresAt: Date.now() + (image ? ttlMs : 10 * 60_000) };
      cache.set(mint, hit);
      if (cache.size > 300) cache.delete(cache.keys().next().value);
    }
    if (!hit.image) { res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' }); res.end('{"error":"No logo is available for this token."}'); return true; }
    res.writeHead(200, { 'content-type': hit.image.type, 'content-length': hit.image.bytes.length, 'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'" });
    res.end(hit.image.bytes);
    return true;
  };
}
