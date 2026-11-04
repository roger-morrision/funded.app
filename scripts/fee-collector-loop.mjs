// Continue only after verified progress. Collection, settlement and payout can
// then advance without waiting a full idle interval between each dependency.
// Errors and uncertain outcomes return to the normal wake/backoff policy.
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
