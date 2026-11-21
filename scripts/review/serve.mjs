// Local review server: serves the Mainnet build in tmp/review/dist (npm run review:build)
// on http://localhost:5180, runs the real live-data layer, and forwards API reads
// (GET, plus read-only Solana RPC POSTs) to richpad.fun. Nothing can be signed or written.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { installLiveData } from '../../server/live/install.mjs';
import { gzipSync } from 'node:zlib';
import { readReviewRpcBody } from './read-only-rpc.mjs';
import { createTokenCreatorRoute } from '../../server/routes/token-creator.mjs';
import { pathToFileURL } from 'node:url';

import { resolve } from 'node:path';
const PORT = Number(process.env.PORT || 5180);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };

export function createReviewServer({ root = 'tmp/review/dist', upstream = 'https://richpad.fun', liveData = true } = {}) {
const ROOT = resolve(root) + '/', UPSTREAM = upstream.replace(/\/$/, '');
const server = createServer();
// Exercise this checkout's new backend read alongside its browser caller. The
// older deployed API does not yet expose it. RPC reads still use the upstream.
const creatorRoute = createTokenCreatorRoute({
  route: (path, _method, pattern) => pattern.exec(path)?.[1],
  solanaRpcUrl: `${UPSTREAM}/api/solana/rpc`,
  respond: (res, status, body) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body)),
});
const handle = async (req, res) => {
  let url, pathname;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400).end('Invalid request path.'); return; }
  if (await creatorRoute(req, res, url)) return;
  if (/^\/(api|devnet-metadata|devnet-images|devnet-banners)\//.test(url.pathname)) {
    // Reject submissions even if a caller already has a signed transaction.
    const rpc = req.method === 'POST' && url.pathname === '/api/solana/rpc';
    if (req.method !== 'GET' && req.method !== 'HEAD' && !rpc) { res.writeHead(405).end('Read-only review proxy'); return; }
    try {
      const body = rpc ? await readReviewRpcBody(req) : undefined;
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, { method: req.method, body, redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { accept: req.headers.accept || '*/*', ...(rpc ? { 'content-type': 'application/json' } : {}) } });
      const headers = {}; for (const [k, v] of upstream.headers) if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) headers[k] = v;
      res.writeHead(upstream.status, headers).end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { res.writeHead(error.status || 502).end(error.status ? error.message : 'Review upstream is unavailable.'); }
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end('Read-only review server'); return; }
  let file = normalize(join(ROOT, pathname));
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(ROOT, 'index.html'); }
  try {
    // Compress text assets like Cloudflare does, so throttled timings are realistic.
    const body = await readFile(file), type = TYPES[extname(file)] || 'application/octet-stream';
    if (/text|javascript|json|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip' }).end(gzipSync(body));
    else res.writeHead(200, { 'content-type': type }).end(body);
  }
  catch { res.writeHead(404).end(); }
};
// The real live data layer (cached reads, /api/live/boot, /api/live socket) in front of the proxy.
server.on('request', liveData ? installLiveData({ server, handle, env: { CORS_ORIGIN: `http://localhost:${PORT}` } }) : handle);
return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = createReviewServer({ upstream: process.env.REVIEW_UPSTREAM || 'https://richpad.fun' });
  server.listen(PORT, '127.0.0.1', () => {
    const port = server.address().port;
    console.log(`review server http://127.0.0.1:${port}`);
    process.send?.({ type: 'review-ready', port });
  });
}
