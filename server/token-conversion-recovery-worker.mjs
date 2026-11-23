import assert from 'node:assert/strict';

// A private, recovery-only scheduler. The controller owns the durable cursor
// and the transport enforces recoveryOnly on every selected saved attempt.
// Construction does not register a listener or start a timer.
export function createTokenConversionRecoveryWorker({controller,limit=32,intervalMs=60000,onError=()=>{}}){
  assert(controller&&typeof controller.recoverNext==='function','Private recovery controller required.');
  assert(Number.isSafeInteger(limit)&&limit>=1&&limit<=32,'Bounded recovery page required.');
  assert(Number.isSafeInteger(intervalMs)&&intervalMs>=1000&&intervalMs<=3600000,'Bounded recovery interval required.');
  assert(typeof onError==='function','Recovery error handler required.');
  let timer=null,inFlight=null,stopped=true,fault=null,lastResult=null;
  function tick(){
    if(fault)return Promise.reject(fault);
    if(inFlight)return inFlight;
    inFlight=Promise.resolve().then(()=>controller.recoverNext({limit})).then(result=>{
      assert(result&&Array.isArray(result.attempts)&&result.attempts.length<=limit,'Invalid bounded recovery result.');
      lastResult={attempts:result.attempts.length,remaining:result.remaining};
      return result;
    }).catch(error=>{
      fault=error;stopped=true;
      if(timer!==null){clearTimeout(timer);timer=null;}
      try{onError(error);}catch{} // The original error is retained for the caller.
      throw error;
    }).finally(()=>{inFlight=null;});
    return inFlight;
  }
  function schedule(){
    if(stopped||fault||timer!==null)return;
    timer=setTimeout(()=>{
      timer=null;
      void tick().catch(()=>{}).finally(schedule);
    },intervalMs);
    timer.unref?.();
  }
  function start(){
    assert(!fault,'Recovery worker fault requires a new reviewed instance.');
    if(!stopped)return;
    stopped=false;
    void tick().catch(()=>{}).finally(schedule);
  }
  async function stop(){
    stopped=true;
    if(timer!==null){clearTimeout(timer);timer=null;}
    if(inFlight)await inFlight.catch(()=>{});
  }
  return {tick,start,stop,status:()=>({running:!stopped,faulted:!!fault,lastResult})};
}
