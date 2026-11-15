import { GLOBAL_TOPICS, tokenTopicPaths } from './live-topics.js';
import { LIVE_API_ORIGIN, rememberLive, confirmLive } from './live-cache.js';

// Push channel: one WebSocket per tab to /api/live. It subscribes to the shared
// public reads and, on a token page, to that token's reads. Each pushed
// snapshot lands in the live cache (served to page code by the fetch layer)
// and fires `funded:live-update` so views can redraw at once.
// Reconnects with back-off; closes while the tab is hidden for a minute.
const GLOBAL_PATHS = GLOBAL_TOPICS.map(topic => topic.path);
const routeMint = () => globalThis.location?.pathname.match(/^\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] || null;

export function startLiveSocket({ WebSocketImpl = globalThis.WebSocket } = {}) {
  if (typeof WebSocketImpl !== 'function' || globalThis.__richpadLiveSocket) return null;
  let socket = null, retry = 0, retryTimer = null, hiddenTimer = null, routePaths = [];
  const url = `${LIVE_API_ORIGIN.replace(/^http/, 'ws')}/api/live`;
  const send = message => { if (socket?.readyState === 1) socket.send(JSON.stringify(message)); };

  const syncRoute = () => {
    const next = tokenTopicPaths(routeMint());
    const drop = routePaths.filter(path => !next.includes(path)), add = next.filter(path => !routePaths.includes(path));
    if (drop.length) send({ op: 'unsub', paths: drop });
    if (add.length) send({ op: 'sub', paths: add });
    routePaths = next;
  };

  const connect = () => {
    clearTimeout(retryTimer);
    if (socket || globalThis.document?.hidden) return;
    try { socket = new WebSocketImpl(url); } catch { schedule(); return; }
    socket.onopen = () => {
      retry = 0;
      send({ op: 'sub', paths: GLOBAL_PATHS });
      routePaths = []; // a new socket has no route subscriptions yet
      syncRoute();
    };
    socket.onmessage = event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message?.op === 'snap' && typeof message.path === 'string')
        rememberLive(message.path, message.body, { ageMs: Math.max(0, Date.now() - Number(message.at || Date.now())), maxAgeMs: Number(message.maxAgeMs) || 30_000 });
      if (message?.op === 'fresh' && typeof message.path === 'string')
        confirmLive(message.path, { ageMs: Math.max(0, Date.now() - Number(message.at || Date.now())), maxAgeMs: Number(message.maxAgeMs) || 30_000 });
    };
    socket.onclose = () => { socket = null; schedule(); };
    socket.onerror = () => {};
  };
  function schedule() {
    clearTimeout(retryTimer);
    if (globalThis.document?.hidden) return;
    const delay = Math.min(30_000, 1_000 * 2 ** retry++) + Math.random() * 500;
    retryTimer = setTimeout(connect, delay);
  }

  globalThis.__richpadLiveSocket = true;
  for (const name of ['popstate', 'hashchange', 'funded:route-change']) globalThis.addEventListener?.(name, syncRoute);
  globalThis.document?.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (globalThis.document.hidden) hiddenTimer = setTimeout(() => { socket?.close(); socket = null; }, 60_000);
    else { retry = 0; connect(); }
  });
  connect();
  return { close: () => { clearTimeout(retryTimer); socket?.close(); } };
}
