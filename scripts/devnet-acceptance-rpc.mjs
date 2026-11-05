import {setTimeout as wait} from 'node:timers/promises';
import {createRpcReadScheduler} from '../src/features/shared/rpc-read-scheduler.js';

// Test-runner transport only. Never replay a signed submission, simulation,
// faucet call or unknown method. Retry individual idempotent reads, not flows.
export function createAcceptanceRpcFetch({fetchImpl=globalThis.fetch,sleep=wait}={}) {
 const readMethods=new Set(['getGenesisHash','getAccountInfo','getMultipleAccounts','getBalance',
  'getMinimumBalanceForRentExemption','getSignatureStatuses','getLatestBlockhash','getBlockHeight',
  'getTokenAccountsByOwner','getTokenAccountBalance','getSlot','getTransaction','getFeeForMessage']);
 const send=async(url,init={})=>{
  let body;try{body=JSON.parse(init.body);}catch{}
  const requests=Array.isArray(body)?body:[body];
  const retryable=requests.length>0&&requests.every(row=>readMethods.has(row?.method));
  for(let attempt=0;;attempt++){
   init.signal?.throwIfAborted();
   const signal=AbortSignal.any([AbortSignal.timeout(25_000),...(init.signal?[init.signal]:[])]);
   const response=await fetchImpl(url,{...init,signal});
   let limited=response.status===429||response.status===503;
   if(retryable&&response.ok){const payload=await response.clone().json().catch(()=>null);
    limited=(Array.isArray(payload)?payload:[payload]).some(row=>row?.error?.code===429);}
   if(!retryable||!limited||attempt>=3)return response;
   const retryAfter=response.headers.get('retry-after');
   const seconds=retryAfter==null?NaN:Number(retryAfter);
   const delayMs=Number.isFinite(seconds)?Math.max(1000,seconds*1000):1000*2**attempt;
   // A longer provider cooldown requires operator intervention, not a retry storm.
   if(delayMs>10_000)return response;
   await response.body?.cancel();
   await sleep(delayMs,undefined,{signal:init.signal});
  }
 };
 return createRpcReadScheduler({fetch:send,maxActive:1,maxQueued:64});
}
