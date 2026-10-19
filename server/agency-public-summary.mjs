import {agencySelectionMask} from '../agency-mint-router-v3.js';
const exact=value=>typeof value==='string'&&/^(0|[1-9]\d{0,19})$/.test(value)&&BigInt(value)<=0xffffffffffffffffn;
export function agencyPublicSummary({state,programId,approvedHash,build,now=Date.now()}){
  const launches=Object.values(state.launches||{}).filter(launch=>launch.cluster==='devnet'
    &&launch.onchainVerified===true&&launch.pumpFeeRoute?.programId===programId&&launch.pumpFeeRoute.protocolSplit?.agencyPercent===10);
  let paid=0n,spent=0n;
  const rows=launches.map(launch=>{
    const row=state.adminSettings?.agencyBudgets?.[launch.mint],age=now-Date.parse(row?.checkedAt);
    if(!row?.verified||row.programId!==programId||row.approvedHash!==approvedHash||row.build!==build
      ||row.scope!=='finalized-pump-sources-and-agency-vault'||!Number.isSafeInteger(row.slot)||row.slot<1
      ||!/^[a-f0-9]{64}$/.test(row.policyFingerprint)||!Number.isFinite(age)||age<0||age>180000
      ||!exact(row.paidLamports)||!exact(row.spentLamports)||BigInt(row.spentLamports)>BigInt(row.paidLamports)
      ||row.selectedMask!==agencySelectionMask(launch.marketingAgency?.selectedAgents||[]))return{mint:launch.mint,status:'awaiting-fresh-finalized-snapshot'};
    paid+=BigInt(row.paidLamports);spent+=BigInt(row.spentLamports);
    return{...row,status:'worker-verified-snapshot',name:launch.name||launch.symbol||launch.mint};
  });
  const complete=rows.every(row=>row.status==='worker-verified-snapshot');
  const history=Object.values(state.v3AgencyExecutions||{}).filter(row=>row.status==='finalized'
    &&row.intent?.programId===programId&&row.intent.approvedHash===approvedHash&&row.proof?.finalized===true
    &&row.proof.balanceDeltaVerified===true&&row.proof.signature===row.signature).map(row=>({mint:row.intent.mint,agent:row.intent.agent,
      signature:row.signature,finalizedAt:row.finalizedAt,slot:row.proof.slot,amountLamports:row.proof.amount||row.proof.spentLamports,
      burnedBaseUnits:row.proof.burnedBaseUnits||null,postUrl:row.proof.post?.url||null,status:'worker-recorded-finalized'}))
    .sort((a,b)=>String(b.finalizedAt).localeCompare(String(a.finalizedAt))).slice(0,50);
  return{funding:{status:complete?'worker-verified-snapshots':'partial',scope:'last-finalized-worker-snapshots-of-registered-launches',
    collectedLamports:complete?String(paid):null,spentLamports:complete?String(spent):null,maxAgeSeconds:180},
    launches:rows,history,historyStatus:'worker-recorded-finalized',
    evidenceNote:'Budgets are timestamped finalized worker snapshots. History records verified execution receipts; page rendering does not re-execute or prove a new payment.'};
}
