import {readFile} from 'node:fs/promises';
import {createRpcGateway,createRpcUpstreamTransport,RPC_GATEWAY_DEVNET_GENESIS} from '../server/rpc-gateway.mjs';
import {createRpcGatewayServer,createRpcSignatureServer} from '../server/rpc-gateway-server.mjs';
import {createRedisRpcCache} from '../server/redis-rpc-cache.mjs';
import {rpcGatewayPacing} from '../server/rpc-gateway-pacing.mjs';

if(process.env.SOLANA_CLUSTER!=='devnet')throw Error('RPC gateway requires the approved Devnet cluster');
const url=process.env.FUNDED_RPC_UPSTREAM_URL||(await readFile(process.env.FUNDED_RPC_UPSTREAM_URL_FILE,'utf8')).trim();
const sharedCache=process.env.FUNDED_RPC_REDIS_URL?createRedisRpcCache({url:process.env.FUNDED_RPC_REDIS_URL,genesis:RPC_GATEWAY_DEVNET_GENESIS}):null;
await sharedCache?.start();
const pacing=rpcGatewayPacing(url);
const gateway=createRpcGateway({transport:createRpcUpstreamTransport(url,{maxSockets:pacing.maxConcurrent}),sharedCache,...pacing});
const server=createRpcGatewayServer({gateway}),signatures=createRpcSignatureServer({gateway});
server.listen(Number(process.env.PORT||8899),'0.0.0.0');signatures.server.listen(Number(process.env.WS_PORT||8900),'0.0.0.0');
const initialize=async()=>{try{const ready=await gateway.initialize();console.log(JSON.stringify({event:'rpc_gateway_readiness',ready,cluster:'devnet'}));}catch{console.error(JSON.stringify({event:'rpc_gateway_readiness',ready:false}));}};
await initialize();
const timer=setInterval(()=>{if(!gateway.stats().upstreamVerified)void initialize();},30000);timer.unref();
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);await signatures.close();
  await new Promise(resolve=>server.close(resolve));gateway.close();}
process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
