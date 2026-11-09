const revision=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const statuses=new Set(['passed-live','partial','blocked','unavailable','failed','vm-only']);

// Summarize checked-in evidence without upgrading it to current acceptance.
// The newer report schema records individual steps, including later failures.
// Those steps are useful historical evidence, not a complete acceptance case.
export function mainnetEvidenceSummary(evidence) {
  if(evidence?.schemaVersion!==1||evidence.cluster!=='devnet')return null;
  if(revision(evidence.application?.revision)&&Array.isArray(evidence.acceptance))return {
    revision:evidence.application.revision,format:'acceptance-matrix',
    acceptance:evidence.acceptance.filter(row=>statuses.has(row?.status)),observations:[],
  };
  if(!revision(evidence.appRevisionTested)||!Array.isArray(evidence.newLaunch?.checks))return null;
  const steps=evidence.newLaunch.checks.filter(row=>typeof row?.name==='string'&&['passed','failed'].includes(row.status));
  const groups={
    'launch-standard':['v3-launch','live-registration'],
    'buy-and-sell':['buy','buy-fee-delta','sell','sell-fee-delta'],
    'collect-and-settle':['creator-fee-collection','settlement','settlement-idempotency'],
    'protocol-payouts':['referral-level-1','referral-level-2','referral-level-3','community-funding','operations-payout'],
  };
  const acceptance=Object.entries(groups).flatMap(([id,names])=>{
    const found=steps.filter(row=>names.includes(row.name));
    return found.length?[{id,status:'partial',detail:`Historical step report: ${found.filter(row=>row.status==='passed').length} passed, ${found.filter(row=>row.status==='failed').length} failed. Full current-release acceptance is still required.`}]:[];
  });
  if(evidence.adminWithdrawal?.verified===true)acceptance.push({id:'admin-operations-withdrawal',status:'partial',
    detail:'Historical verified withdrawal is recorded; revalidate the complete case on the final release.'});
  if(evidence.creatorClaim)acceptance.push({id:'creator-payout',status:'partial',
    detail:'A historical creator claim is recorded; revalidate beneficiary, deltas and duplicate handling on the final release.'});
  return {revision:evidence.appRevisionTested,format:'financial-step-report',acceptance,
    observations:steps.filter(row=>row.status==='failed').map(row=>({name:row.name,status:'failed'}))};
}
