export function receiptRetentionOptions({before,limit=100,apply=false}={},now=Date.now()) {
  const cutoff=typeof before==='string'?Date.parse(before):NaN;
  if(!Number.isFinite(cutoff)||cutoff>now-7*86400000)throw new Error('Choose an explicit cutoff at least seven days old.');
  if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Choose 1–500 cached proofs per batch.');
  if(typeof apply!=='boolean')throw new Error('Apply must be an explicit boolean.');
  return {before:new Date(cutoff).toISOString(),limit,apply};
}
export function expiredReceiptProofs(proofs,options) {
  const {before,limit}=receiptRetentionOptions(options),cutoff=Date.parse(before);
  return Object.entries(proofs||{}).filter(([,entry])=>Number.isFinite(Date.parse(entry?.verifiedAt))&&Date.parse(entry.verifiedAt)<cutoff)
    .sort(([a,x],[b,y])=>Date.parse(x.verifiedAt)-Date.parse(y.verifiedAt)||(a<b?-1:a>b?1:0)).slice(0,limit+1);
}
export function receiptRetentionResult(options,selected,hasMore,removed=0) {
  return {scope:'derived-finalized-proof-cache-only',mode:options.apply?'apply':'dry-run',before:options.before,
    selected,removed,hasMore,ledgerRecordsRemoved:0,
    warning:'Evicted proofs need fresh finalized RPC verification. Archived transactions may be unavailable; missing evidence must not be shown as paid or as complete lifetime earnings.'};
}
