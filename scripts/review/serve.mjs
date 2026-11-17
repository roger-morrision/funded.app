// Local review server: serves the Mainnet build in tmp/review/dist (npm run review:build)
// on http://localhost:5180, runs the real live-data layer, and forwards API reads
// (GET, plus read-only Solana RPC POSTs) to richpad.fun. Nothing can be signed or written.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { installLiveData } from '../../server/live/install.mjs';
import { gzipSync } from 'node:zlib';

import { resolve } from 'node:path';
const ROOT = resolve('tmp/review/dist') + '/';
const UPSTREAM = process.env.REVIEW_UPSTREAM || 'https://richpad.fun';
const PORT = Number(process.env.PORT || 5180);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };

const server = createServer();
const handle = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (/^\/(api|devnet-metadata|devnet-images|devnet-banners)\//.test(url.pathname)) {
    // Only reads: GET/HEAD, plus JSON-RPC POSTs (no wallet is connected, so nothing can be signed).
    const rpc = req.method === 'POST' && url.pathname === '/api/solana/rpc';
    if (req.method !== 'GET' && req.method !== 'HEAD' && !rpc) { res.writeHead(405).end('Read-only review proxy'); return; }
    try {
      const body = rpc ? await new Promise(done => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => done(Buffer.concat(parts))); }) : undefined;
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, { method: req.method, body, headers: { accept: req.headers.accept || '*/*', ...(rpc ? { 'content-type': 'application/json' } : {}) } });
      const headers = {}; for (const [k, v] of upstream.headers) if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) headers[k] = v;
      res.writeHead(upstream.status, headers).end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { res.writeHead(502).end(String(error)); }
    return;
  }
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
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
server.on('request', installLiveData({ server, handle, env: { CORS_ORIGIN: `http://localhost:${PORT}` } }));
server.listen(PORT, () => console.log(`review server http://localhost:${PORT}`));
