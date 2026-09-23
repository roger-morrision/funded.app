const statuses=new Set(['running','batch-finished','pass-finished','blocked','failed','aborted']);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function receiptWorkerOutcome(value) {
  if(!statuses.has(value?.status))throw new Error('Invalid receipt worker outcome.');
  return {status:value.status,startedAt:timestamp(value.startedAt),finishedAt:timestamp(value.finishedAt),pages:count(value.pages)};
}
export function receiptWorkerStatus(row, {now=Date.now(),maxAgeMs=300000}={}) {
  const lease=Number(row?.expiresAt)||0,progress=row?.progress||{},outcome=row?.lastRun;
  const lastRun=outcome&&statuses.has(outcome.status)?receiptWorkerOutcome(outcome):null;
  const lastActivity=Date.parse(lastRun?.finishedAt||lastRun?.startedAt||'');
  const ageMs=Number.isFinite(lastActivity)?Math.max(0,now-lastActivity):null;
  let status=!row?'never-run':row.owner?(lease>now?'running':'stalled'):!lastRun?'unknown':lastRun.status==='running'?'stalled':lastRun.status;
  if(!['running','stalled','never-run','unknown'].includes(status)&&ageMs!==null&&ageMs>maxAgeMs)status='stale';
  const totals=value=>({checked:count(value?.checked),verified:count(value?.verified),unresolved:count(value?.unresolved)});
  return {scope:'recorded-receipts-only',cluster:'devnet',status,ageMs,lastRun,
    currentPass:totals(progress),passes:count(progress.passes),
    lastPass:progress.lastPass?{...totals(progress.lastPass),finishedAt:timestamp(progress.lastPass.finishedAt)}:null,
    leaseExpiresAt:lease>0?new Date(lease).toISOString():null,
    coverageComplete:false,financialExecution:false,
    guidance:'Worker activity is not full-chain coverage or payout readiness. Blocked, failed, stalled or stale work needs operator review; no payout should be resent.'};
}
