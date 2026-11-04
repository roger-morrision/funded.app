// Full-directory refreshes and selected-mint reads share work per scope. A slower
// directory response must not overwrite a more recent selected-mint result.
export function createReserveLoader(app, render) {
  const flights = new Map(), versions = new Map();
  let sequence = 0;
  return function load({ mint = null } = {}) {
    const key = mint || '*';
    if (flights.has(key)) return flights.get(key);
    const version = ++sequence;
    app.communityReserveStates ||= new Map();
    if (mint) { app.communityReserveStates.set(mint, 'loading'); versions.set(mint, version); }
    const request = Promise.resolve().then(async () => {
      const response = await app.apiRequest('/api/airdrops/reserves' + (mint ? `?mint=${encodeURIComponent(mint)}` : ''),
        { signal:AbortSignal.timeout(mint ? 45_000 : 60_000) }).catch(() => ({ available:false }));
      const ready = response.available && response.data?.cluster === 'devnet' && Array.isArray(response.data.reserves);
      app.verifiedCommunityReserves ||= new Map();
      if (!mint) {
        app.communityReserveStatus = ready ? 'ready' : 'unavailable';
        app.communityClaimPolicy = ready ? response.data.claimPolicy || null : null;
      }
      const rows = ready ? response.data.reserves.filter(row => row?.mint && (!mint || row.mint === mint)) : [];
      const affected = mint ? [mint] : [...new Set([...app.verifiedCommunityReserves.keys(), ...rows.map(row => row.mint)])];
      for (const id of affected) {
        if ((versions.get(id) || 0) > version) continue;
        versions.set(id, version);
        const row = rows.find(row => row.mint === id);
        if (row) app.verifiedCommunityReserves.set(id, row);
        else app.verifiedCommunityReserves.delete(id);
        app.communityReserveStates.set(id, ready && row ? 'ready' : 'unavailable');
      }
      render();
    }).finally(() => { if (flights.get(key) === request) flights.delete(key); });
    flights.set(key, request);
    return request;
  };
}
