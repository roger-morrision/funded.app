// Helius Free supports 10 RPC/s and 1 sendTransaction/s. Stay below its read
// limit, preserve the conservative public-provider budget and pace writes
// independently. No additional provider connection or retry is introduced.
export function rpcGatewayPacing(upstreamUrl){
 let hostname;
 try{hostname=new URL(upstreamUrl).hostname;}catch{throw Error('Invalid RPC gateway pacing configuration');}
 const helius=hostname==='helius-rpc.com'||hostname.endsWith('.helius-rpc.com');
 // Helius limits requests per second, not open connections: let a few reads
 // wait on the provider at once so one slow response does not stall the queue.
 return{minIntervalMs:helius?250:500,blockIntervalMs:2500,sendIntervalMs:1000,maxConcurrent:helius?4:1};
}
