import {Connection} from '@solana/web3.js';

// All server instances share Node's HTTP pool. The SDK's per-Connection agents
// otherwise create new connections for each proof/readiness check.
const sharedFetch=(target,options={})=>fetch(target,{...options,
  signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
let pending=Promise.resolve(),nextRequestAt=0;
function pacedFetch(transport,target,options={}) {
  const request=pending.then(async()=>{
    options.signal?.throwIfAborted();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,nextRequestAt-Date.now())));
    options.signal?.throwIfAborted();nextRequestAt=Date.now()+500;
    return transport(target,options);
  });
  pending=request.catch(()=>{});return request;
}
export class SharedRpcConnection extends Connection {
  constructor(endpoint,options='finalized') {
    const config=typeof options==='string'?{commitment:options}:options;
    const transport=config?.fetch||sharedFetch;
    super(endpoint,{disableRetryOnRateLimit:true,...config,fetch:(target,options)=>pacedFetch(transport,target,options)});
  }
}
