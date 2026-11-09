import { createRpcReadRecovery } from './rpc-read-recovery.js';
// Bound browser RPC reads across discovery, token details and trade previews.
// Transactions, simulations and faucet requests are never queued or retried here.
export function createRpcReadScheduler({fetch:send=globalThis.fetch,maxActive=4,maxQueued=128,cluster,timeoutMs}={}) {
  if(!Number.isInteger(maxActive)||maxActive<1||!Number.isInteger(maxQueued)||maxQueued<1)throw new Error('Invalid RPC queue limits');
  const recover=createRpcReadRecovery({fetch:send,cluster,timeoutMs});
  let active=0;const queue=[];
  const drain=()=>{
    while(active<maxActive&&queue.length){
      const entry=queue.shift();entry.signal?.removeEventListener('abort',entry.abort);
      if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}
      active++;
      Promise.resolve().then(()=>recover(entry.input,entry.init,true)).then(entry.resolve,entry.reject).finally(()=>{active--;drain();});
    }
  };
  return function scheduledFetch(input,init={}) {
    let request;try{request=JSON.parse(init.body);}catch{return recover(input,init);}
    const reads=Array.isArray(request)?request:[request];
    // Exact allowlist: unknown methods keep the SDK's normal behavior.
    const allowed=new Set(['getAccountInfo','getMultipleAccounts','getBalance','getTokenAccountsByOwner',
      'getTokenAccountBalance','getMinimumBalanceForRentExemption','getSlot','getBlockHeight',
      'getLatestBlockhash','getGenesisHash','getSignatureStatuses','getTransaction','getSignaturesForAddress',
      'getTokenLargestAccounts','getTokenSupply','getProgramAccounts','getBlockTime','getVersion','getEpochInfo','getFeeForMessage','isBlockhashValid']);
    if(!reads.length||!reads.every(row=>allowed.has(row?.method)))return recover(input,init);
    const signal=init.signal;
    if(signal?.aborted)return Promise.reject(signal.reason);
    if(queue.length>=maxQueued)return Promise.reject(new Error('RPC read queue is busy; retry shortly.'));
    return new Promise((resolve,reject)=>{
      const entry={input,init,signal,resolve,reject};
      entry.abort=()=>{const at=queue.indexOf(entry);if(at>=0){queue.splice(at,1);reject(signal.reason);}};
      signal?.addEventListener('abort',entry.abort,{once:true});
      // Prioritize explicit quotes without allowing them to exceed the shared cap.
      let interactive=false;try{interactive=new URL(String(input),globalThis.location?.origin).searchParams.get('purpose')==='trade-preview';}catch{}
      if(interactive){const at=queue.findIndex(row=>!row.interactive);entry.interactive=true;queue.splice(at<0?queue.length:at,0,entry);}else queue.push(entry);
      drain();
    });
  };
}
