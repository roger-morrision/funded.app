import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {EventEmitter,once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {installRewardShutdown} from '../../server/reward-shutdown.mjs';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
async function within(promise){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shutdown did not complete with an open upgraded socket.')),1000);})]);}
 finally{clearTimeout(timer);}
}
async function fixture(t,{handle,drain}){
 const server=createServer(),signals=new EventEmitter(),exited=deferred(),failed=deferred();
 let exitCode=null;
 installRewardShutdown({server,signals,handle,drain,exit:code=>{exitCode=code;exited.resolve(code);},
  logger:{log(){},error:row=>failed.resolve(JSON.parse(row))}});
 const sockets=new WebSocketServer({noServer:true});
 server.on('upgrade',(req,socket,head)=>sockets.handleUpgrade(req,socket,head,()=>{}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port,client=new WebSocket(`ws://127.0.0.1:${port}/live`);
 await once(client,'open');
 t.after(()=>{client.terminate();for(const socket of sockets.clients)socket.terminate();server.closeAllConnections();server.close();sockets.close();});
 return{server,signals,client,port,exited:exited.promise,failed:failed.promise,exitCode:()=>exitCode};
}

test('shutdown finishes with an open WebSocket only after admitted work and ledger drain',async t=>{
 const admitted=deferred(),finishRequest=deferred(),draining=deferred(),finishDrain=deferred();
 t.after(()=>{finishRequest.resolve();finishDrain.resolve();});
 const c=await fixture(t,{handle:async(req,res)=>{admitted.resolve();await finishRequest.promise;res.end('saved');},
  drain:async()=>{draining.resolve();await finishDrain.promise;}});
 const response=new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:c.port,method:'POST',path:'/save'},res=>{
  let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve(body));res.on('error',reject);
 });req.on('error',reject);req.end();});
 await admitted.promise;c.signals.emit('SIGTERM');
 assert.equal(c.client.readyState,WebSocket.OPEN);assert.equal(c.exitCode(),null);
 finishRequest.resolve();assert.equal(await response,'saved');await draining.promise;
 assert.equal(c.client.readyState,WebSocket.OPEN);assert.equal(c.exitCode(),null);
 finishDrain.resolve();assert.equal(await within(c.exited),0);
});

test('failed ledger drain keeps shutdown unconfirmed and does not close upgraded connections',async t=>{
 const c=await fixture(t,{handle:(_req,res)=>res.end(),drain:async()=>{throw new Error('durability unconfirmed');}});
 c.signals.emit('SIGTERM');
 assert.equal((await within(c.failed)).code,'DRAIN_UNCONFIRMED');
 assert.equal(c.client.readyState,WebSocket.OPEN);assert.equal(c.exitCode(),null);
});
