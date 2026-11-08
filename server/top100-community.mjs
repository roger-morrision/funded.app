// Count visible retained posts, not wallet identities or private message content.
// A call is a chat post with a callout marker and is counted only once.
export function top100CommunityCounts(coinChats = {}, now = Date.now()) {
  const items = {};
  for (const [mint, rows] of Object.entries(coinChats || {})) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !Array.isArray(rows)) continue;
    const ids = new Set();
    let calls = 0, chats = 0;
    for (const row of rows) {
      const at = Date.parse(row?.createdAt);
      if (!row?.id || ids.has(row.id) || row.mint !== mint || ['hidden','deleted'].includes(row.status)
        || !Number.isFinite(at) || at > now || at < now - 86400000) continue;
      ids.add(row.id);
      if (row.callout) calls++; else chats++;
    }
    items[mint] = {calls, chats, total:calls + chats};
  }
  return {scope:'retained-visible-posts-24h', observedAt:now, items};
}
