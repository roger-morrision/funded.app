import {readFile} from 'node:fs/promises';
import {createRpcGateway,createRpcUpstreamTransport} from '../server/rpc-gateway.mjs';
import {requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';
import {createRpcGatewayServer,createRpcSignatureServer} from '../server/rpc-gateway-server.mjs';
import {createRedisRpcCache} from '../server/redis-rpc-cache.mjs';
import {rpcGatewayPacing} from '../server/rpc-gateway-pacing.mjs';
import {createRpcFailoverTransport,isHeliusRpc,publicRpcForCluster} from '../server/rpc-failover.mjs';
import {createRotatingRpcTransport} from '../server/rpc-rotation.mjs';

const cluster=requireSolanaCluster(process.env.SOLANA_CLUSTER);
const url=process.env.FUNDED_RPC_UPSTREAM_URL||(await readFile(process.env.FUNDED_RPC_UPSTREAM_URL_FILE,'utf8')).trim();
const sharedCache=process.env.FUNDED_RPC_REDIS_URL?createRedisRpcCache({url:process.env.FUNDED_RPC_REDIS_URL,genesis:SOLANA_GENESIS[cluster]}):null;
await sharedCache?.start();
// FUNDED_RPC_FREE_URLS: comma-separated free endpoints rotated first; the
// configured upstream (e.g. paid Helius) is used only when all free ones cool down.
const freeUrls=String(process.env.FUNDED_RPC_FREE_URLS||'').split(',').map(value=>value.trim()).filter(Boolean);
const rotating=freeUrls.length>0;
const pacing=rotating?{minIntervalMs:80,blockIntervalMs:2500,sendIntervalMs:500,maxConcurrent:4}:rpcGatewayPacing(url);
const primary=createRpcUpstreamTransport(url,{maxSockets:pacing.maxConcurrent});
const hostName=value=>new URL(value).hostname;
const transport=rotating?createRotatingRpcTransport({
  free:freeUrls.map(value=>({name:hostName(value),transport:createRpcUpstreamTransport(value,{maxSockets:2})})),
  paid:freeUrls.includes(url)?[]:[{name:hostName(url),transport:primary}]}):isHeliusRpc(url)?createRpcFailoverTransport({primary,publicTransport:createRpcUpstreamTransport(publicRpcForCluster(cluster),{maxSockets:2}),cluster,
  // Public Mainnet allows ~10 req/s per IP; stay well below it.
  publicOptions:cluster==='mainnet-beta'?{minIntervalMs:150,maxConcurrent:2}:{}}):primary;
const gateway=createRpcGateway({transport,sharedCache,cluster,...pacing});
const server=createRpcGatewayServer({gateway}),signatures=createRpcSignatureServer({gateway});
server.listen(Number(process.env.PORT||8899),'0.0.0.0');signatures.server.listen(Number(process.env.WS_PORT||8900),'0.0.0.0');
const initialize=async()=>{try{const ready=await gateway.initialize();console.log(JSON.stringify({event:'rpc_gateway_readiness',ready,cluster}));}catch{console.error(JSON.stringify({event:'rpc_gateway_readiness',ready:false}));}};
await initialize();
const timer=setInterval(()=>{if(!gateway.stats().upstreamVerified)void initialize();},30000);timer.unref();
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);await signatures.close();
  await new Promise(resolve=>server.close(resolve));gateway.close();}
process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
