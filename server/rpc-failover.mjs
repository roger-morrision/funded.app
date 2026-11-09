import {createRpcGateway} from './rpc-gateway.mjs';
import {requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';
import {rpcWriteBlocked} from './network-write-policy.mjs';

export const PUBLIC_DEVNET_RPC='https://api.devnet.solana.com';
export const PUBLIC_MAINNET_RPC='https://api.mainnet-beta.solana.com';
export const publicRpcForCluster=cluster=>{requireSolanaCluster(cluster);return cluster==='devnet'?PUBLIC_DEVNET_RPC:PUBLIC_MAINNET_RPC;};
const unavailable=()=>({status:503,headers:{},body:null});
export function isHeliusRpc(url){
  const hostname=new URL(url).hostname;
  return hostname==='helius-rpc.com'||hostname.endsWith('.helius-rpc.com');
}
export function isRpcQuotaRejection(response){
  // Never replay a response containing a result, even if its HTTP status is wrong.
  if(response?.body&&typeof response.body==='object'&&Object.hasOwn(response.body,'result'))return false;
  if(response?.status===429)return true;
  const error=response?.body?.error;
  if(response?.status===200&&error?.code===429)return true;
  const message=typeof response?.body==='string'?response.body:String(error?.message||'');
  return [402,403].includes(response?.status)&&/(?:credits?.*(?:exhausted|exceeded|depleted)|out of credits|quota.*(?:exceeded|exhausted)|max(?:imum)? usage reached)/i.test(message);
}

// Reads can fail over on transport/server outages. Writes are replayed only on
// explicit quota rejection; ambiguous submission outcomes never trigger replay.
// The nested gateway gives the public provider its own conservative shared queue,
// batching/caching and rate-limit cooldown instead of inheriting Helius throughput.
export function createRpcFailoverTransport({primary,publicTransport,recoveryIntervalMs=600000,
  now=Date.now,publicOptions={},cluster='devnet'}={}){
  if(typeof primary!=='function'||typeof publicTransport!=='function'||!Number.isSafeInteger(recoveryIntervalMs)||recoveryIntervalMs<30000)
    throw Error('Valid RPC transports and a recovery interval of at least 30 seconds are required');
  requireSolanaCluster(cluster);
  const fallback=createRpcGateway({transport:publicTransport,now,...publicOptions,cluster,
    minIntervalMs:500,blockIntervalMs:2500,sendIntervalMs:1000,maxConcurrent:1});
  let active=false,nextProbeAt=0,probe=null,closed=false,failovers=0,recoveryProbes=0,primaryAttempts=0,publicRequests=0;
  async function recover(){
    if(probe)return probe;
    if(now()<nextProbeAt)return;
    nextProbeAt=now()+recoveryIntervalMs;
    probe=(async()=>{
      recoveryProbes++;primaryAttempts++;
      try{
        const id='funded-provider-recovery',response=await primary({jsonrpc:'2.0',id,method:'getGenesisHash',params:[]});
        if(!closed&&response.status===200&&response.body?.jsonrpc==='2.0'&&response.body.id===id
          &&!response.body.error&&response.body.result===SOLANA_GENESIS[cluster])active=false;
      }catch{/* Stay on the already verified public provider; no write was probed. */}
    })().finally(()=>{probe=null;});
    return probe;
  }
  const transport=async payload=>{
    if(closed)throw Error('RPC transport is closed');
    if(rpcWriteBlocked(cluster,payload.method))return {status:403,headers:{},body:{jsonrpc:'2.0',id:payload.id,error:{code:-32005,message:'Mainnet transaction submission is not activated.'}}};
    if(active)await recover();
    if(!active){
      primaryAttempts++;
      const readonly=/^get[A-Z][A-Za-z0-9]*$/.test(payload.method)||payload.method==='isBlockhashValid';
      let response;
      try{response=await primary(payload);}catch(error){if(!readonly)throw error;response={status:503};}
      if(response.status===200&&(response.body?.jsonrpc!=='2.0'||response.body.id!==payload.id))return response;
      const readOutage=readonly&&[500,502,503,504].includes(response.status)
        &&!(response.body&&typeof response.body==='object'&&Object.hasOwn(response.body,'result'));
      if(!isRpcQuotaRejection(response)&&!readOutage)return response;
      if(!active){active=true;failovers++;nextProbeAt=now()+recoveryIntervalMs;}
    }
    if(!await fallback.initialize())return unavailable();
    publicRequests++;
    const response=await fallback.request(payload);
    return {status:response.httpStatus,headers:{},body:response.body};
  };
  transport.stats=()=>({enabled:true,cluster,activeProvider:active?`public-${cluster}`:'helius',failovers,recoveryProbes,
    primaryAttempts,publicRequests,nextPrimaryProbeInMs:active?Math.max(0,nextProbeAt-now()):0,
    publicVerified:fallback.stats().upstreamVerified,publicRateLimited:fallback.stats().rateLimited});
  transport.close=()=>{closed=true;fallback.close();primary.close?.();};
  return transport;
}
