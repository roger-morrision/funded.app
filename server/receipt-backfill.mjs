import { randomUUID } from 'node:crypto';
import { RECEIPT_WINDOW } from './receipt-candidates.mjs';

export function backfillPosition(value = {}) {
  const bucket=value.bucket||'collections',after=value.after||'';
  if(!['collections','payouts'].includes(bucket)||typeof after!=='string'||Buffer.byteLength(after)>1024)throw new Error('Invalid receipt backfill position.');
  return {bucket,after};
}
export function receiptBackfillPage(state, cluster, position) {
  const {bucket,after}=backfillPosition(position),status=bucket==='collections'?'collected':'paid';
  const rows=Object.entries(state[bucket]||{}).filter(([key,row])=>Buffer.compare(Buffer.from(key),Buffer.from(after))>0&&row?.cluster===cluster&&row.status===status&&typeof row.signature==='string'&&row.signature.length)
    .sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  const selected=rows.slice(0,RECEIPT_WINDOW);
  return {state:{[bucket]:Object.fromEntries(selected)},after:selected.at(-1)?.[0]||after,hasMore:rows.length>RECEIPT_WINDOW,count:selected.length};
}

// Advances only after durable finalized evidence processing. No signing or transfer API.
// A completed pass covers recorded eligible rows, not all transactions on the chain.
export async function runReceiptBackfill({store,readEvidence,cluster='devnet',maxPages=5,signal,now=()=>new Date().toISOString()}) {
  if(cluster!=='devnet')throw new Error('Receipt backfill is Devnet-only.');
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw new Error('Choose 1–100 backfill pages per batch.');
  signal?.throwIfAborted();
  const owner=randomUUID(),leaseMs=120000;
  const acquired=await store.acquireReceiptBackfill(cluster,owner,leaseMs);
  if(!acquired)return {status:'busy',scope:'recorded-receipts',pages:0};
  let progress={bucket:'collections',after:'',passes:0,checked:0,verified:0,unresolved:0,...acquired};
  let pages=0;
  const startedAt=now();
  async function finish(result) {
    if(!await store.recordReceiptBackfillOutcome(cluster,owner,{status:result.status,startedAt,finishedAt:now(),pages}))throw new Error('Receipt worker lease expired before outcome recording.');
    return result;
  }
  try {
    if(!await store.recordReceiptBackfillOutcome(cluster,owner,{status:'running',startedAt,pages}))throw new Error('Receipt worker lease expired before starting.');
    while(pages<maxPages) {
      signal?.throwIfAborted();
      const page=await store.readReceiptBackfillPage(cluster,backfillPosition(progress));
      const evidence=await readEvidence(page.state);
      signal?.throwIfAborted();
      if(evidence.commitment!=='finalized'||evidence.status==='unavailable'||evidence.indexStorage==='unavailable') {
        return await finish({status:'blocked',scope:'recorded-receipts',pages,reason:'Finalized RPC evidence or durable proof storage is unavailable. Cursor was not advanced for this page.',progress});
      }
      const verified=evidence.verifiedCollections.length+evidence.verifiedPayouts.length;
      if(!Number.isSafeInteger(verified)||verified>page.count)throw new Error('Unexpected receipt evidence count.');
      const finished=progress.bucket==='payouts'&&!page.hasMore;
      const next={...progress,checked:progress.checked+page.count,verified:progress.verified+verified,
        unresolved:progress.unresolved+page.count-verified,updatedAt:now(),scope:'recorded-receipts'};
      if(page.hasMore)next.after=page.after;
      else {next.bucket=progress.bucket==='collections'?'payouts':'collections';next.after='';}
      if(finished){next.passes++;next.lastPass={checked:next.checked,verified:next.verified,unresolved:next.unresolved,finishedAt:now()};next.checked=next.verified=next.unresolved=0;}
      if(!await store.checkpointReceiptBackfill(cluster,owner,next,leaseMs))throw new Error('Receipt backfill lease expired or was replaced; checkpoint rejected.');
      progress=next;pages++;
      if(finished)return await finish({status:'pass-finished',scope:'recorded-receipts',pages,progress});
    }
    return await finish({status:'batch-finished',scope:'recorded-receipts',pages,progress});
  } catch(error) {
    // Never persist raw dependency errors: they may contain RPC URLs or credentials.
    await store.recordReceiptBackfillOutcome(cluster,owner,{status:signal?.aborted?'aborted':'failed',startedAt,finishedAt:now(),pages}).catch(()=>false);
    throw error;
  } finally {await store.releaseReceiptBackfill(cluster,owner);}
}
