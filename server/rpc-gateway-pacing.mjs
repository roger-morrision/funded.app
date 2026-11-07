// Helius Free supports 10 RPC/s and 1 sendTransaction/s. Stay below its read
// limit, preserve the conservative public-provider budget and pace writes
// independently. No additional provider connection or retry is introduced.
export function rpcGatewayPacing(upstreamUrl){
 let hostname;
 try{hostname=new URL(upstreamUrl).hostname;}catch{throw Error('Invalid RPC gateway pacing configuration');}
 const helius=hostname==='helius-rpc.com'||hostname.endsWith('.helius-rpc.com');
 // Helius limits requests per second, not open connections: let a few reads
 // wait on the provider at once so one slow response does not stall the queue.
 // 150 ms (about 6.7 reads/s) leaves a third of the 10 RPC/s budget unused; on
 // 2026-11-06 the gateway had made 11,182 upstream calls with zero 429 responses
 // at 250 ms, and page-load bursts of about seven reads queued for up to ~1.75 s.
 return{minIntervalMs:helius?150:500,blockIntervalMs:2500,sendIntervalMs:1000,maxConcurrent:helius?4:1};
}
