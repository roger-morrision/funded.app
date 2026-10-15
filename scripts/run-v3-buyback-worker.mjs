import { readFileSync } from 'node:fs';
import { shouldAttemptV3Buyback } from '../server/v3-buyback-worker-policy.mjs';

if (process.env.SOLANA_CLUSTER !== 'devnet') throw new Error('Automatic V3 buyback worker is Devnet-only.');
const endpoint = new URL(process.env.FUNDED_INTERNAL_APP_URL || 'http://app:8787');
const origin = process.env.CORS_ORIGIN || 'https://funded.vip';
const token = String(process.env.FUNDED_API_TOKEN || (process.env.FUNDED_API_TOKEN_FILE
  ? readFileSync(process.env.FUNDED_API_TOKEN_FILE, 'utf8') : '')).trim();
if (!token) throw new Error('Automatic V3 buyback worker requires internal API authorization.');
const retryAt = new Map();

async function request(path, method = 'GET') {
  const response = await fetch(new URL(path, endpoint), { method,
    headers:{ authorization:`Bearer ${token}`, origin,
      ...(method === 'POST' ? { 'content-type':'application/json' } : {}) },
    ...(method === 'POST' ? { body:'{}' } : {}),signal:AbortSignal.timeout(90_000) });
  const result = await response.json();
  return { status:response.status, result };
}

async function tick() {
  if (process.env.FUNDED_V3_BUYBACK_ENABLED !== 'true') return;
  const { status, result } = await request('/api/buyback/status');
  if (status !== 200 || result.cluster !== 'devnet') throw new Error('Buyback status unavailable.');
  const pending = Array.isArray(result.pending) ? result.pending : [];
  for (const row of pending) {
    if (!shouldAttemptV3Buyback(row, { triggerReached:result.dashboard?.triggerReached,
      retryAt:retryAt.get(row.sourceCollectionSignature) || 0 })) continue;
    const path = `/api/tokens/${row.mint}/v3-buyback/${row.sourceCollectionSignature}`;
    const executed = await request(path, 'POST');
    if (executed.status === 200) retryAt.delete(row.sourceCollectionSignature);
    else if (executed.status !== 503)
      retryAt.set(row.sourceCollectionSignature,Date.now()+10*60_000);
    console.log(JSON.stringify({ event:'v3_buyback_attempt', mint:row.mint,
      source:row.sourceCollectionSignature,status:executed.status,
      signature:executed.status === 200 ? executed.result.signature : null,
      reason:executed.status === 200 ? null : String(executed.result?.error || 'Execution unavailable').slice(0,160),
      outcome:executed.status === 200 ? 'finalized' : 'pending-or-blocked' }));
  }
}

await new Promise(resolve => setTimeout(resolve, 10_000));
for (;;) {
  try { await tick(); }
  catch (error) { console.error(JSON.stringify({ event:'v3_buyback_worker_error',
    reason:String(error.message || error).slice(0,240) })); }
  await new Promise(resolve => setTimeout(resolve, 60_000));
}
