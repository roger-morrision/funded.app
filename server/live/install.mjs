import { request as httpRequest } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLiveHub } from './hub.mjs';
import { liveTopic } from '../../src/lib/live-topics.js';

// Headers from the original response that are safe to replay on cached answers.
const SKIP_HEADERS = new Set(['date', 'content-length', 'etag', 'set-cookie', 'x-request-id', 'connection', 'keep-alive', 'transfer-encoding']);
const MAX_SOCKETS = 2_000, MAX_PATHS_PER_SOCKET = 40;

// Raw JSON bodies are embedded as-is rather than re-encoded as strings.
const snapMessage = (path, snap, maxAgeMs) => `{"op":"snap","path":${JSON.stringify(path)},"at":${snap.at},"maxAgeMs":${maxAgeMs},"body":${snap.body}}`;

function allowedOrigin(origin, configured, host) {
  if (!origin) return false;
  try { if (host && new URL(origin).host === host) return true; } catch {}
  if (configured && origin === configured) return true;
  try { const url = new URL(origin); return ['localhost', '127.0.0.1'].includes(url.hostname) || (configured && url.hostname === new URL(configured).hostname); } catch { return false; }
}

// Wraps the app handler with the live data layer and attaches /api/live to the server.
export function installLiveData({ server, handle, env = process.env }) {
  const enabled = env.FUNDED_LIVE_DATA !== 'false';
  if (!enabled) return handle;
  const headers = new Map(); // path -> replayable response headers
  // The real read: the app's own handler over loopback, marked so this layer passes it through.
  const read = path => new Promise((resolve, reject) => {
    const port = server.address()?.port;
    if (!port) { reject(new Error('Server not listening')); return; }
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { 'x-live-hub': '1', accept: 'application/json' }, timeout: 20_000 }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 2_000_000) req.destroy(new Error('Too large')); else chunks.push(chunk); });
      res.on('end', () => {
        const kept = {}; for (const [name, value] of Object.entries(res.headers)) if (!SKIP_HEADERS.has(name)) kept[name] = value;
        if (res.statusCode === 200 && String(res.headers['content-type'] || '').includes('application/json')) headers.set(path, kept);
        resolve({ status: String(res.headers['content-type'] || '').includes('application/json') ? res.statusCode : 0, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });
  const hub = createLiveHub({ read });
  hub.start();

  const sendJson = (res, status, body, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(body); };

  async function liveHandle(req, res) {
    const path = req.url || '/';
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (read && req.headers['x-live-hub'] !== '1') {
      if (path === '/api/live/boot') {
        const boot = await hub.boot();
        const parts = Object.entries(boot.entries).map(([key, row]) => `${JSON.stringify(key)}:{"at":${row.at},"maxAgeMs":${row.maxAgeMs},"body":${row.body}}`);
        sendJson(res, 200, `{"serverTime":${boot.serverTime},"entries":{${parts.join(',')}}}`, { 'x-content-type-options': 'nosniff' });
        return;
      }
      if (path === '/api/live/status') { sendJson(res, 200, JSON.stringify({ ...hub.stats(), sockets: sockets.clients.size })); return; }
      if (liveTopic(path)) {
        const snap = hub.lookup(path);
        if (snap) {
          const extra = { ...(headers.get(path) || {}), etag: `"${snap.etag}"`, 'cache-control': 'no-cache', 'x-live-cache': snap.state, age: String(Math.floor((Date.now() - snap.at) / 1000)) };
          if (req.headers['if-none-match'] === `"${snap.etag}"`) { res.writeHead(304, extra); res.end(); return; }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...extra });
          res.end(req.method === 'HEAD' ? undefined : snap.body);
          return;
        }
      }
    }
    return handle(req, res);
  }

  // Browser push channel: {"op":"sub","paths":[...]} / {"op":"unsub","paths":[...]}.
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8_192, perMessageDeflate: false });
  const upgrade = (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/api/live') { if (pathname !== '/api/solana/ws') socket.destroy(); return; }
    if (!allowedOrigin(request.headers.origin, env.CORS_ORIGIN || env.PUBLIC_APP_URL, request.headers['x-forwarded-host'] || request.headers.host) || sockets.clients.size >= MAX_SOCKETS) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, client => {
      const owned = new Map(); // path -> unsubscribe
      let alive = true;
      const push = (path, snap) => { if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 1_000_000) client.send(snapMessage(path, snap, (hub.intervalOf(path) || 30_000) * 2)); };
      client.on('pong', () => { alive = true; });
      client.on('error', () => {});
      client.on('close', () => { for (const stop of owned.values()) stop(); owned.clear(); });
      client.on('message', bytes => {
        let message; try { message = JSON.parse(bytes.toString()); } catch { return; }
        const paths = Array.isArray(message?.paths) ? message.paths.filter(path => typeof path === 'string').slice(0, MAX_PATHS_PER_SOCKET) : [];
        if (message?.op === 'sub') for (const path of paths) {
          if (owned.has(path) || owned.size >= MAX_PATHS_PER_SOCKET) continue;
          const stop = hub.subscribe(path, push);
          if (!stop) continue;
          owned.set(path, stop);
          const snap = hub.snapshot(path);
          if (snap) push(path, snap);
        }
        if (message?.op === 'unsub') for (const path of paths) { owned.get(path)?.(); owned.delete(path); }
      });
      client.alive = () => { const was = alive; alive = false; return was; };
    });
  };
  upgrade.liveData = true;
  server.on('upgrade', upgrade);
  const heartbeat = setInterval(() => { for (const client of sockets.clients) { if (!client.alive?.()) client.terminate(); else client.ping(); } }, 30_000);
  heartbeat.unref?.();
  server.on('close', () => { clearInterval(heartbeat); hub.stop(); for (const client of sockets.clients) client.terminate(); });
  return liveHandle;
}
