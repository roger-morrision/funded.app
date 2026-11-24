// Keep public receipt information in memory even when durable storage fails.
// This cannot prove account deltas; it only prevents a possible broadcast from
// being reported as "nothing sent" by the surrounding launch flow.
export function createLaunchRecoveryRecorder(persist=()=>{}){
  let lastBroadcast=null;
  return {
    async record(event){
      if(event.signature&&['submitted','confirmed','unknown'].includes(event.state))
        lastBroadcast={step:event.step,signature:event.signature,broadcastAttempted:true,
          outcome:event.state==='confirmed'?'finalized-success':'unknown'};
      return await persist(event);
    },
    failure(error){
      const recovery=error?.launchRecovery?.broadcastAttempted?error.launchRecovery:lastBroadcast||error?.launchRecovery;
      if(!recovery)return error;
      const failure=new Error(String(error?.message||error),{cause:error});
      failure.launchRecovery={...recovery};
      failure.knownFailure=recovery.outcome==='finalized-failure';
      if(error?.journalUnavailable)failure.journalUnavailable=true;
      return failure;
    },
  };
}
