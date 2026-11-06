import {WorkerStoppingError} from './worker-lifecycle.mjs';

// Continue only after verified progress. Collection, settlement and payout can
// then advance without waiting a full idle interval between each dependency.
// Errors and uncertain outcomes return to the normal wake/backoff policy.
export async function collectFeeCandidates({candidates,pausedMints,lifecycle,request,minimumLamports,onError}){
  let collected=0,errors=0;
  for(const candidate of candidates){
    lifecycle.assertRunning();
    if(pausedMints.has(candidate.mint)||candidate.collectionStatus
      &&!['complete','nothing-to-collect','no-fees','retryable-before-submission'].includes(candidate.collectionStatus))continue;
    let stage='fee-read';
    try{
      const activity=await request(`/api/tokens/${encodeURIComponent(candidate.mint)}/fee-activity?view=balance`);
      const pump=activity.overview?.pump;
      if(activity.overview?.available!==true||pump?.status!=='confirmed'||!/^\d+$/.test(String(pump.accruedLamports)))continue;
      if(BigInt(pump.accruedLamports)<minimumLamports(candidate.mint))continue;
      lifecycle.assertRunning();stage='collection';
      // Never retry a submission within this scan. The API records uncertain
      // outcomes, and subsequent candidate snapshots exclude those mints.
      const result=await request('/api/keeper/collect',{mint:candidate.mint});
      if(result.scope==='per-mint-v3'&&result.status==='collected'&&result.onchainVerified===true&&result.signature)collected++;
    }catch(error){
      if(error instanceof WorkerStoppingError)throw error;
      errors++;await onError({mint:candidate.mint,stage,error});
      // Preserve an admitted request's failure before shutdown ends the scan.
      lifecycle.assertRunning();
    }
  }
  return {collected,errors};
}

export async function runFeeCollectorLoop({lifecycle,once=false,shouldRun,tick,onError}){
  let followup=false;
  while(!lifecycle.stopped){
    if(!once&&!followup&&!await shouldRun()){
      await lifecycle.wait(5000);continue;
    }
    followup=false;
    try{
      const result=await tick();
      followup=result?.status==='ready'&&result.settlementErrors===0
        &&['collected','settled','disbursed'].some(key=>Number.isSafeInteger(result[key])&&result[key]>0);
    }catch(error){await onError(error);}
    if(once||lifecycle.stopped)break;
    await lifecycle.wait(5000);
  }
}
