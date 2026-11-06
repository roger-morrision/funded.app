import { readFile, writeFile } from 'node:fs/promises';
import { feeCollectionMinimumLamports } from '../server/devnet-qa-minimums.mjs';
import { pausedFeeCollectionMints } from '../server/fee-collection-pause.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createWorkerLifecycle, WorkerStoppingError } from './worker-lifecycle.mjs';
import { createTradeWakePoll } from './trade-wake-poll.mjs';
import {runFeeCollectorLoop,collectFeeCandidates} from './fee-collector-loop.mjs';

const heartbeat = join(tmpdir(),'funded-fee-collector-status.json');
const intervalMs = Math.max(60_000, Number(process.env.FUNDED_FEE_COLLECTION_TICK_MS || 300_000));
const api = String(process.env.FUNDED_FEE_COLLECTION_API || 'http://app:8787').replace(/\/$/, '');

if (process.argv.includes('--check')) {
  const state = JSON.parse(await readFile(heartbeat, 'utf8'));
  if (Date.now() - Date.parse(state.at) > intervalMs * 2 + 30_000 || state.status !== 'ready') process.exitCode = 1;
} else {
  if (process.env.SOLANA_CLUSTER !== 'devnet') throw new Error('Automatic Pump fee collection is Devnet only.');
  const lifecycle = createWorkerLifecycle({ name:'fee-collector' });
  const shouldRun = createTradeWakePoll({intervalMs});
  try {
  const pausedMints=pausedFeeCollectionMints();
  const token = (await readFile(process.env.FUNDED_API_TOKEN_FILE, 'utf8')).trim();
  if (!token) throw new Error('Keeper API token is required.');
  async function request(path, body) {
    lifecycle.assertRunning();
    // Leave time for the server's 15-second vault read to return its status.
    const readTimeoutMs = path.endsWith('/fee-activity?view=balance') ? 30_000 : 15_000;
    const response = await fetch(`${api}${path}`, { method:body ? 'POST' : 'GET', headers:{ authorization:`Bearer ${token}`, ...(body ? { 'content-type':'application/json' } : {}) }, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(['/api/keeper/collect','/api/keeper/settle-v3','/api/keeper/disburse-v3','/api/keeper/reconcile-v3-collection'].includes(path) ? 120_000 : readTimeoutMs) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${String(data.error || 'request failed').slice(0, 160)}`);
    return data;
  }
  async function tick() {
    const candidates = await request('/api/keeper/collection-candidates');
    if (candidates.cluster !== 'devnet') throw new Error('API cluster is not Devnet.');
    let collected = 0;
    let settled = 0;
    let settlementErrors = 0;
    let disbursed = 0;
    for(const pending of candidates.pendingV3Collections||[]){
      lifecycle.assertRunning();if(pausedMints.has(pending.mint))continue;
      try{const result=await request('/api/keeper/reconcile-v3-collection',pending);if(result.status==='collected')collected++;}
      catch(error){settlementErrors++;console.error(`V3 collection reconciliation ${pending.mint}: ${String(error.message||error)}`);}
    }
    for (const pending of candidates.automaticSettlementEnabled ? candidates.pendingV3Settlements || [] : []) {
      lifecycle.assertRunning();
      if (pausedMints.has(pending.mint) || pending.status === 'verification-pending') continue;
      try {
        const result = await request('/api/keeper/settle-v3', {
          mint:pending.mint, collectionSignature:pending.collectionSignature });
        if (result.status === 'finalized') settled += 1;
      } catch (error) {
        settlementErrors += 1;
        console.error(`V3 settlement ${pending.mint}: ${String(error.message || error)}`);
      }
    }
    for(const action of candidates.pendingV3Disbursements||[]){
      lifecycle.assertRunning();
      if(pausedMints.has(action.mint))continue;
      try{
        const result=await request('/api/keeper/disburse-v3',action);
        if(result.status==='finalized')disbursed++;
      }catch(error){settlementErrors++;console.error(`V3 disbursement ${action.mint}: ${String(error.message||error)}`);}
    }
    const scan=await collectFeeCandidates({candidates:candidates.mints||[],pausedMints,lifecycle,request,
      minimumLamports:mint=>feeCollectionMinimumLamports(mint,process.env.SOLANA_CLUSTER,process.env),
      onError:({mint,stage,error})=>console.error(`V3 ${stage} ${mint}: ${String(error.message||error)}`)});
    collected+=scan.collected;settlementErrors+=scan.errors;
    if(scan.errors&&process.argv.includes('--once'))process.exitCode=1;
    if (lifecycle.stopped) return;
    const status = { status:settlementErrors ? 'degraded' : 'ready', at:new Date().toISOString(), checked:(candidates.mints || []).length,
      collected, settled, disbursed, settlementErrors, pausedMints:[...pausedMints], pendingSettlement:(candidates.pendingV3Settlements || []).length };
    await writeFile(heartbeat, JSON.stringify(status));
    console.log(JSON.stringify(status));
    return status;
  }
  await runFeeCollectorLoop({lifecycle,once:process.argv.includes('--once'),
    shouldRun:()=>shouldRun(()=>request('/api/automation/wakeup')),tick,
    onError:error=>{if (!(error instanceof WorkerStoppingError)) {
      console.error(`Fee collector: ${String(error.message || error)}`); if(process.argv.includes('--once'))process.exitCode=1;
    }}});
  } finally { lifecycle.dispose(); }
}
