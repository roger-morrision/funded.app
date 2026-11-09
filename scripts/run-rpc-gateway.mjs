import {readFile} from 'node:fs/promises';
import {createRpcGateway,createRpcUpstreamTransport} from '../server/rpc-gateway.mjs';
import {requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';
import {createRpcGatewayServer,createRpcSignatureServer} from '../server/rpc-gateway-server.mjs';
import {createRedisRpcCache} from '../server/redis-rpc-cache.mjs';
import {rpcGatewayPacing} from '../server/rpc-gateway-pacing.mjs';
import {createRpcFailoverTransport,isHeliusRpc,publicRpcForCluster} from '../server/rpc-failover.mjs';

const cluster=requireSolanaCluster(process.env.SOLANA_CLUSTER);
const url=process.env.FUNDED_RPC_UPSTREAM_URL||(await readFile(process.env.FUNDED_RPC_UPSTREAM_URL_FILE,'utf8')).trim();
const sharedCache=process.env.FUNDED_RPC_REDIS_URL?createRedisRpcCache({url:process.env.FUNDED_RPC_REDIS_URL,genesis:SOLANA_GENESIS[cluster]}):null;
await sharedCache?.start();
const pacing=rpcGatewayPacing(url);
const primary=createRpcUpstreamTransport(url,{maxSockets:pacing.maxConcurrent});
const transport=isHeliusRpc(url)?createRpcFailoverTransport({primary,publicTransport:createRpcUpstreamTransport(publicRpcForCluster(cluster)),cluster}):primary;
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
