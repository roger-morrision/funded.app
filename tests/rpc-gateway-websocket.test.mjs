import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
import {Connection} from '@solana/web3.js';
import bs58 from 'bs58';
import {createRpcGateway,RPC_GATEWAY_DEVNET_GENESIS} from '../server/rpc-gateway.mjs';
import {createRpcGatewayServer,createRpcSignatureServer} from '../server/rpc-gateway-server.mjs';
import {installRpcWebsocketProxy} from '../server/rpc-websocket-proxy.mjs';
import {createConnectionsController} from '../src/app/controllers/connections.js';

const signature=bs58.encode(Buffer.alloc(64,9));
async function fixture(){
  const calls=[];let level='confirmed';
  const gateway=createRpcGateway({minIntervalMs:0,transport:async request=>{
    calls.push(request);
    const result=request.method==='getGenesisHash'?RPC_GATEWAY_DEVNET_GENESIS:
      request.method==='getSignatureStatuses'?{context:{slot:100},value:request.params[0].map(()=>({slot:99,err:null,confirmationStatus:level,confirmations:level==='finalized'?null:2}))}:100;
    return{status:200,headers:{},body:{jsonrpc:'2.0',id:request.id,result}};
  }});await gateway.initialize();
  const http=createRpcGatewayServer({gateway}),signatures=createRpcSignatureServer({gateway,pollIntervalMs:60000});
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>signatures.server.listen(0,'127.0.0.1',resolve));
  const app=createServer((_req,res)=>res.end());
  installRpcWebsocketProxy(app,{upstreamUrl:`ws://127.0.0.1:${signatures.server.address().port}`,allowedOrigin:'https://funded.vip'});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const clients=[];
  const connect=async()=>{const ws=new WebSocket(`ws://127.0.0.1:${app.address().port}/api/solana/ws`,{origin:'https://funded.vip'});
    clients.push(ws);await once(ws,'open');return ws;};
  return{gateway,calls,http,signatures,app,connect,setLevel:value=>{level=value;},close:async()=>{
    for(const client of clients)client.terminate();await signatures.close();await new Promise(resolve=>app.close(resolve));
    http.closeAllConnections();await new Promise(resolve=>http.close(resolve));gateway.close();
  }};
}

test('browser confirmation sockets share one provider status poll and retain requested finality',async()=>{
  const f=await fixture();
  try{
    const clients=await Promise.all([f.connect(),f.connect()]);
    for(const [index,client] of clients.entries()){
      client.send(JSON.stringify({jsonrpc:'2.0',method:'ping'}));
      const message=once(client,'message');client.send(JSON.stringify({jsonrpc:'2.0',id:index+1,method:'signatureSubscribe',params:[signature,{commitment:'finalized'}]}));
      const [bytes]=await message;assert.equal(JSON.parse(bytes).id,index+1);
    }
    await f.signatures.poll();assert.equal(f.signatures.subscriptionCount(),2);
    f.setLevel('unknown');await f.signatures.poll();assert.equal(f.signatures.subscriptionCount(),2,'unknown finality must never confirm payment');
    f.setLevel('finalized');const messages=clients.map(client=>once(client,'message'));
    await f.signatures.poll();
    for(const [bytes] of await Promise.all(messages)){const message=JSON.parse(bytes);assert.equal(message.method,'signatureNotification');assert.equal(message.params.result.value.err,null);}
    const polls=f.calls.filter(row=>row.method==='getSignatureStatuses');assert.equal(polls.length,3);assert(polls.every(row=>row.params[0].length===1));
    assert.equal(f.signatures.subscriptionCount(),0);
  }finally{await f.close();}
});

test('SDK confirmation works through the private signature service without provider WebSockets',async()=>{
  const f=await fixture();
  try{
    const connection=new Connection(`http://127.0.0.1:${f.http.address().port}`,{commitment:'finalized',disableRetryOnRateLimit:true,
      wsEndpoint:`ws://127.0.0.1:${f.signatures.server.address().port}`});
    const confirm=connection.confirmTransaction(signature,'finalized');
    for(let poll=0;poll<100&&!f.signatures.subscriptionCount();poll++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(f.signatures.subscriptionCount(),1);f.setLevel('finalized');await f.signatures.poll();
    assert.equal((await confirm).value.err,null);
    connection._rpcWebSocket.setAutoReconnect(false);
    const closed=once(connection._rpcWebSocket,'close');connection._rpcWebSocket.close(1000);await closed;
    assert(f.calls.some(row=>row.method==='getSignatureStatuses'));
  }finally{await f.close();}
});

test('proxy rejects unapproved origins and unsupported subscriptions never call the provider',async()=>{
  const f=await fixture();
  try{
    const client=new WebSocket(`ws://127.0.0.1:${f.app.address().port}/api/solana/ws`,{origin:'https://unapproved.invalid'});
    await assert.rejects(once(client,'open'),/403/);client.terminate();
    const allowed=await f.connect(),message=once(allowed,'message'),before=f.calls.length;
    allowed.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'accountSubscribe',params:['account']}));
    assert(JSON.parse((await message)[0]).error);assert.equal(f.calls.length,before);
  }finally{await f.close();}
});

test('browser RPC connections use the matching same-origin signature gateway',()=>{
  const state={APP_CLUSTER:'devnet',APP_RPC_URL:'https://funded.vip/api/solana/rpc'};
  const config=createConnectionsController(state).connectionConfig({clusterApiUrl:()=>{throw Error('must use the gateway');}});
  assert.equal(config.wsEndpoint,'wss://funded.vip/api/solana/ws');assert.equal(config.disableRetryOnRateLimit,true);
});
