// Callouts: chat posts that "call" a coin. The server records the market cap
// when the call is made, and the public feed shows how each call has done
// since (now and peak), with a ranking of callers by their results.
const FEED_LIMIT = 100;
const STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CALLOUT_REPEAT_MS = 30 * 60 * 1000;

export function calloutMultiple(called, current) {
  return Number.isFinite(called) && called > 0 && Number.isFinite(current) && current > 0 ? current / called : null;
}

// One lucky call should not top the board: callers need this many calls in
// the window for a numbered rank. Others are listed after, marked unranked.
export const MIN_RANKED_CALLS = 3;

export function rankCallers(entries, nowMs = Date.now()) {
  const byAuthor = new Map();
  for (const entry of entries) {
    if (nowMs - Date.parse(entry.createdAt) > STATS_WINDOW_MS || !Number.isFinite(entry.peakMultiple)) continue;
    const row = byAuthor.get(entry.author) || { author: entry.author, calls: 0, hits: 0, bestMultiple: 0, totalMultiple: 0 };
    row.calls += 1;
    row.hits += entry.peakMultiple >= 2 ? 1 : 0;
    row.bestMultiple = Math.max(row.bestMultiple, entry.peakMultiple);
    row.totalMultiple += entry.peakMultiple;
    byAuthor.set(entry.author, row);
  }
  return [...byAuthor.values()]
    .map(({ totalMultiple, ...row }) => ({ ...row, avgMultiple: totalMultiple / row.calls, hitRate: row.hits / row.calls, ranked: row.calls >= MIN_RANKED_CALLS }))
    .sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.avgMultiple - a.avgMultiple || b.calls - a.calls || a.author.localeCompare(b.author))
    .slice(0, 10);
}

export function createCalloutFeed({ store, readMarketCaps, readTokenMeta = mint => store.readMetadata?.(mint), now = Date.now, cacheMs = 2_000 }) {
  const meta = new Map();
  let cached = null;
  let peakWrite = 0;
  async function tokenMeta(mint) {
    if (!meta.has(mint)) meta.set(mint, Promise.resolve().then(() => readTokenMeta(mint)).then(record => record
      ? { name: String(record.name || '').slice(0, 40), symbol: String(record.symbol || '').slice(0, 12), image: typeof record.image === 'string' ? record.image : null }
      : null).catch(() => null));
    return meta.get(mint);
  }
  async function build() {
    const stored = (await store.readCallouts(500)).filter(entry => !entry.hidden);
    const recent = stored.slice(-FEED_LIMIT).reverse();
    const mints = [...new Set(recent.map(entry => entry.mint))];
    const [caps, tokens] = await Promise.all([
      readMarketCaps(mints).catch(() => ({})),
      Promise.all(mints.map(async mint => [mint, await tokenMeta(mint)])).then(Object.fromEntries),
    ]);
    // Likes live on each call's chat message.
    const likes = new Map();
    await Promise.all(mints.map(async mint => {
      const messages = await Promise.resolve(store.readCoinChat?.(mint, 200)).catch(() => []);
      for (const message of messages || []) if (Array.isArray(message.likes)) likes.set(message.id, message.likes);
    }));
    const raised = [];
    const callouts = recent.map(entry => {
      const current = caps[entry.mint]?.marketCapSol ?? null;
      const peak = Math.max(entry.peakMarketCapSol || entry.marketCapSol, current || 0);
      if (current && current > (entry.peakMarketCapSol || entry.marketCapSol) * 1.02) raised.push([entry.id, current]);
      return {
        id: entry.id, mint: entry.mint, author: entry.author, text: entry.text, createdAt: entry.createdAt,
        likeCount: likes.get(entry.id)?.length || 0, likedBy: (likes.get(entry.id) || []).slice(-200),
        token: tokens[entry.mint] || null,
        holdingPercent: Number.isFinite(entry.holdingPercent) ? entry.holdingPercent : null,
        calledMarketCapSol: entry.marketCapSol, currentMarketCapSol: current, peakMarketCapSol: peak,
        multiple: calloutMultiple(entry.marketCapSol, current), peakMultiple: calloutMultiple(entry.marketCapSol, peak),
        graduated: Boolean(caps[entry.mint]?.graduated),
        marketObservedAt: caps[entry.mint]?.observedAt || null,
      };
    });
    // Peaks are only seen while someone watches; save new highs at most every 30s.
    if (raised.length && now() - peakWrite > 30_000) {
      peakWrite = now();
      const highs = new Map(raised);
      void store.updateCallouts(list => { for (const entry of list) if (highs.has(entry.id)) entry.peakMarketCapSol = Math.max(entry.peakMarketCapSol || 0, highs.get(entry.id)); }).catch(() => {});
    }
    const statsInput = stored.map(entry => {
      const live = callouts.find(row => row.id === entry.id);
      return { author: entry.author, createdAt: entry.createdAt, peakMultiple: live?.peakMultiple ?? calloutMultiple(entry.marketCapSol, entry.peakMarketCapSol || entry.marketCapSol) };
    });
    return { callouts, topCallers: rankCallers(statsInput, now()), serverTime: new Date(now()).toISOString() };
  }
  return async function readFeed() {
    if (cached && now() - cached.at < cacheMs) return cached.value;
    const value = build();
    cached = { at: now(), value };
    value.catch(() => { cached = null; });
    return value;
  };
}

export async function recordCallout({ store, readMarketCaps, readHolderShare = null, mint, author, nowMs = Date.now() }) {
  const recent = await store.readCallouts(500);
  const repeat = [...recent].reverse().find(entry => entry.author === author && entry.mint === mint && !entry.hidden);
  if (repeat && nowMs - Date.parse(repeat.createdAt) < CALLOUT_REPEAT_MS) return { error: 'You already called this coin in the last 30 minutes.', status: 429 };
  const [caps, holdingPercent] = await Promise.all([
    readMarketCaps([mint], { maxAgeMs: 5_000, fresh: true }).catch(() => ({})),
    readHolderShare ? readHolderShare(author, mint).catch(() => null) : null,
  ]);
  const cap = caps[mint];
  if (!cap?.marketCapSol) return { error: 'The market cap is unavailable right now, so the call cannot be recorded. Try again in a moment.', status: 503 };
  return { cap, holdingPercent: Number.isFinite(holdingPercent) ? holdingPercent : null };
}

export function createCalloutRoutes({ readFeed, respond }) {
  return async function handleCalloutRoutes(req, res, url) {
    if (url.pathname !== '/api/callouts' || req.method !== 'GET') return false;
    const feed = await readFeed();
    const mint = url.searchParams.get('mint');
    const author = url.searchParams.get('author');
    const callouts = feed.callouts.filter(row => (!mint || row.mint === mint) && (!author || row.author === author));
    respond(res, 200, { ...feed, callouts });
    return true;
  };
}
