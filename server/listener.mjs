import {createServer} from 'node:http';
import {installRpcWebsocketProxy} from './rpc-websocket-proxy.mjs';
import {installRewardShutdown} from './reward-shutdown.mjs';
import {deploymentCluster} from './network-write-policy.mjs';

export function startAppListener({port,host,handle,solanaRpcUrl,env=process.env}){
 const server=createServer();
 installRpcWebsocketProxy(server,{upstreamUrl:env.FUNDED_RPC_GATEWAY_WS_URL||solanaRpcUrl.replace(/^http/,'ws'),allowedOrigin:env.CORS_ORIGIN||env.PUBLIC_APP_URL,readOnly:deploymentCluster(env)==='mainnet-beta'});
 installRewardShutdown({server,handle});
 server.headersTimeout=10000;server.requestTimeout=30000;server.timeout=120000;
 server.listen(port,host,()=>console.log(`funded.vip app listening on http://${host}:${server.address().port}`));
 return server;
}
