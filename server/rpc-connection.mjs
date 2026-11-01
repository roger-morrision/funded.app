import {Connection} from '@solana/web3.js';

// All server instances share Node's HTTP pool. The SDK's per-Connection agents
// otherwise create new connections for each proof/readiness check.
const sharedFetch=(target,options={})=>fetch(target,{...options,
  signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
export class SharedRpcConnection extends Connection {
  constructor(endpoint,options='finalized') {
    const config=typeof options==='string'?{commitment:options}:options;
    super(endpoint,{disableRetryOnRateLimit:true,...config,fetch:config?.fetch||sharedFetch});
  }
}
