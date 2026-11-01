import {Connection} from '@solana/web3.js';

// All server instances share Node's HTTP pool. The SDK's per-Connection agents
// otherwise create new connections for each proof/readiness check.
const sharedFetch=(target,options={})=>fetch(target,{...options,
  signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
let pending=Promise.resolve(),nextRequestAt=0,nextBlockRequestAt=0;
function pacedFetch(transport,target,options={}) {
  let blockRead=false;
  try {blockRead=JSON.parse(options.body||'{}').method==='getBlock';} catch { /* The SDK validates its request. */ }
  const request=pending.then(async()=>{
    options.signal?.throwIfAborted();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,nextRequestAt-Date.now(),blockRead?nextBlockRequestAt-Date.now():0)));
    options.signal?.throwIfAborted();nextRequestAt=Date.now()+500;
    // Historical snapshots must read every block. Pace the expensive method
    // separately instead of bypassing complete replay when public RPC throttles.
    if(blockRead)nextBlockRequestAt=Date.now()+2500;
    return transport(target,options);
  });
  pending=request.catch(()=>{});return request;
}
export class SharedRpcConnection extends Connection {
  constructor(endpoint,options='finalized') {
    const config=typeof options==='string'?{commitment:options}:options;
    const transport=config?.fetch||sharedFetch;
    const central=process.env.FUNDED_RPC_GATEWAY_ENABLED==='true'&&process.env.FUNDED_RPC_GATEWAY_URL
      &&new URL(endpoint).href===new URL(process.env.FUNDED_RPC_GATEWAY_URL).href;
    // Parallel requests must reach the gateway together to share its atomic
    // account batches. Direct-provider deployments retain the local budget.
    super(endpoint,{disableRetryOnRateLimit:true,...config,fetch:central?transport:(target,options)=>pacedFetch(transport,target,options)});
  }
}
