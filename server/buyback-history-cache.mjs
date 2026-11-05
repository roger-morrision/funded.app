import {latestUnindexedV3Burn} from './v3-buyback-chain-history.mjs';

// Display-only history has its own connection and bounded lifetime. Public
// custody reads may stop waiting without restarting the same slow scan.
export function createBuybackHistoryReader({connectionFactory,read=latestUnindexedV3Burn,
  now=Date.now,ttlMs=30_000,timeoutMs=120_000}) {
  let entry=null;
  return function history(input) {
    const key=JSON.stringify([String(input.programId),[...(input.indexedSignatures||[])].sort(),
      [...(input.indexedReceipts||[])].sort()]);
    if(entry?.key===key && (entry.pending || now()-entry.at<ttlMs))return entry.promise;
    if(entry?.pending) return Promise.reject(new Error('Previous history scan is still completing.'));
    const current={key,pending:true,at:now()};entry=current;
    const controller=new AbortController();let timer;
    const work=Promise.resolve().then(()=>read({...input,signal:controller.signal,
      connection:connectionFactory(controller.signal)}));
    current.promise=Promise.race([work,new Promise((_resolve,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(new Error('Burn history scan timed out.'));},timeoutMs);
      timer.unref?.();
    })]).finally(()=>{
      clearTimeout(timer);controller.abort();current.pending=false;current.at=now();
    });
    return current.promise;
  };
}
