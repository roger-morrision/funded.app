// Read the directory in bounded pages, not just Explore's first 40 coins.
// The ceiling protects clients; coverage is explicitly reported if reached.
export async function loadTop300Feed(request, {signal, maxPages = 200} = {}) {
  const items = new Map(), accounts = {}, marketActivity = {};
  let complete = false, fetchedAt = null, cluster = null, total = null;
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const response = await request(`/api/pump/explore?limit=50&offset=${page * 50}&sort=created_timestamp`, {signal});
    const data = response?.data;
    if (!response?.available || !Array.isArray(data?.items) || (cluster && data.cluster !== cluster)) {
      return {available:false, data:null};
    }
    cluster = data.cluster; fetchedAt = data.fetchedAt;
    total = Number.isSafeInteger(data.total) ? data.total : null;
    for (const item of data.items) if (item.mint) items.set(item.mint, item);
    Object.assign(accounts, data.accountSnapshot?.accounts);
    Object.assign(marketActivity, data.marketActivity);
    if (data.items.length < 50 || (total != null && (page + 1) * 50 >= total)) { complete = true; break; }
  }
  return {available:true, data:{items:[...items.values()], cluster, fetchedAt,
    accountSnapshot:{accounts}, marketActivity, directoryComplete:complete && (total == null || items.size === total), total}};
}

export async function readAccountBatches(connection, keys) {
  const accounts = [];
  for (let offset = 0; offset < keys.length; offset += 100) {
    accounts.push(...await connection.getMultipleAccountsInfo(keys.slice(offset, offset + 100), 'confirmed'));
  }
  return accounts;
}
