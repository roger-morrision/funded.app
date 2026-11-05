// A failed evidence write can occur after a broadcast. An unknown outcome is
// never permission to launch again with the same in-memory payer.
export function createAcceptanceRunGuard(execute) {
 let lastResult,unreconciled=false;
 return async options=>{
  if(unreconciled || lastResult?.transactions?.some(row=>!row.finalized||row.name==='v3-launch') || lastResult?.launchJournal?.signature)
   throw new Error('Prior launch or uncertain submission requires receipt reconciliation before any new run');
  unreconciled=true;
  const result=await execute(options);
  if(!result || !['passed','blocked'].includes(result.status) || !Array.isArray(result.transactions))
   throw new Error('Acceptance outcome is incomplete; reconcile receipts before retrying');
  lastResult=result;
  unreconciled=false;
  return result;
 };
}
