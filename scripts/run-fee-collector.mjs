import { readFile, writeFile } from 'node:fs/promises';

const heartbeat = '/tmp/funded-fee-collector-status.json';
const intervalMs = Math.max(60_000, Number(process.env.FUNDED_FEE_COLLECTION_TICK_MS || 300_000));
const minimum = 10_000_000n;
const api = String(process.env.FUNDED_FEE_COLLECTION_API || 'http://app:8787').replace(/\/$/, '');

if (process.argv.includes('--check')) {
  const state = JSON.parse(await readFile(heartbeat, 'utf8'));
  if (Date.now() - Date.parse(state.at) > intervalMs * 2 + 30_000 || state.status !== 'ready') process.exitCode = 1;
} else {
  if (process.env.SOLANA_CLUSTER !== 'devnet') throw new Error('Automatic Pump fee collection is Devnet only.');
  const token = (await readFile(process.env.FUNDED_API_TOKEN_FILE, 'utf8')).trim();
  if (!token) throw new Error('Keeper API token is required.');
  async function request(path, body) {
    const response = await fetch(`${api}${path}`, { method:body ? 'POST' : 'GET', headers:{ authorization:`Bearer ${token}`, ...(body ? { 'content-type':'application/json' } : {}) }, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(path === '/api/keeper/collect' ? 90_000 : 15_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${String(data.error || 'request failed').slice(0, 160)}`);
    return data;
  }
  async function tick() {
    const candidates = await request('/api/keeper/collection-candidates');
    if (candidates.cluster !== 'devnet') throw new Error('API cluster is not Devnet.');
    let settled = 0, collected = 0;
    for (const signature of candidates.pendingSettlements || []) {
      const result = await request('/api/settlements/claims', { claimSignature:signature });
      if (result.automaticRewards?.status !== 'queued') throw new Error(`Reward queue unavailable for ${signature}.`);
      settled += 1;
    }
    for (const candidate of candidates.mints || []) {
      if (candidate.collectionStatus && !['complete','nothing-to-collect','no-fees'].includes(candidate.collectionStatus)) continue;
      const activity = await request(`/api/tokens/${encodeURIComponent(candidate.mint)}/fee-activity`);
      const pump = activity.overview?.pump;
      if (activity.overview?.available !== true || pump?.status !== 'confirmed' || !/^\d+$/.test(String(pump.accruedLamports))) continue;
      if (BigInt(pump.accruedLamports) < minimum) continue;
      // A failed or timed-out collect is uncertain. The server locks that mint for review.
      const result = await request('/api/keeper/collect', { mint:candidate.mint });
      if (result.status === 'collected' && result.onchainVerified === true && result.signature) {
        collected += 1;
        const settlement = await request('/api/settlements/claims', { claimSignature:result.signature });
        if (settlement.automaticRewards?.status !== 'queued') throw new Error(`Reward queue unavailable for ${result.signature}.`);
        settled += 1;
      }
    }
    const status = { status:'ready', at:new Date().toISOString(), checked:(candidates.mints || []).length, collected, settled };
    await writeFile(heartbeat, JSON.stringify(status));
    console.log(JSON.stringify(status));
  }
  for (;;) {
    try { await tick(); }
    catch (error) { console.error(`Fee collector: ${String(error.message || error)}`); }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
