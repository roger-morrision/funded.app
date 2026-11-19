import {agencyFailureCode} from './agency-worker-diagnostics.mjs';

export function agencyPreparationWait(row,now){
  if(!row||row.signature)return null;
  if(row.nextAttemptAt>now)return {status:'preparation-retry-wait',key:row.key,
    nextAttemptAt:row.nextAttemptAt,reasonCode:row.reasonCode};
  if(row.leaseUntil>now)return {status:'preparation-active',key:row.key};
  return null;
}
export async function recordAgencyPreparationFailure({store,key,token,error,now}){
  return store.update(state=>{
    const row=state.v3AgencyExecutions?.[key];
    if(!row||row.signature||row.token!==token)return;
    const failures=(Number.isSafeInteger(row.preparationFailures)?row.preparationFailures:0)+1;
    Object.assign(row,{status:'preparation-failed',leaseUntil:0,preparationFailures:failures,
      reasonCode:agencyFailureCode(error),failedAt:new Date(now).toISOString(),
      nextAttemptAt:now+Math.min(1800000,120000*2**Math.min(failures-1,4))});
  });
}
