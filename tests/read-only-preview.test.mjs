import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createReadOnlyPreview } from '../server/read-only-preview.mjs';

test('preview supports HEAD and read RPC while blocking all mutation shapes',async()=>{
  const seen=[];
  const upstream=http.createServer((req,res)=>{seen.push(req.method+' '+req.url);res.setHeader('content-type','application/json');res.end('{"ok":true}');});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const preview=createReadOnlyPreview({upstream:`http://127.0.0.1:${upstream.address().port}`,rpcWebsocketUrl:undefined});
  preview.listen(0,'127.0.0.1');await once(preview,'listening');
  const base=`http://127.0.0.1:${preview.address().port}`;
  try {
    const head=await fetch(base+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    for(const [path,payload] of [['/api/admin/withdrawals',{}],['/api/launches',{}],
      ['/api/solana/rpc',{jsonrpc:'2.0',method:'sendTransaction',params:[]}],
      ['/api/solana/rpc',{jsonrpc:'2.0',method:'requestAirdrop',params:[]}],['/api/solana/rpc',[]]]) {
      assert.equal((await fetch(base+path,{method:'POST',body:JSON.stringify(payload)})).status,405);
    }
    assert.deepEqual(seen,['GET /']);
    assert.equal((await fetch(base+'/api/solana/rpc',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:[]})})).status,200);
  } finally {preview.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>preview.close(r)),new Promise(r=>upstream.close(r))]);}
});

test('preview WebSocket forwards subscriptions but rejects transaction submission',async()=>{
  const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});await once(upstream,'listening');
  const forwarded=[];
  upstream.on('connection',client=>client.on('message',raw=>{const value=JSON.parse(raw);forwarded.push(value.method);client.send(JSON.stringify({jsonrpc:'2.0',id:value.id,result:123}));}));
  const preview=createReadOnlyPreview({rpcWebsocketUrl:`ws://127.0.0.1:${upstream.address().port}`});
  preview.listen(0,'127.0.0.1');await once(preview,'listening');
  const client=new WebSocket(`ws://127.0.0.1:${preview.address().port}/api/solana/ws`,{origin:'https://richpad.fun'});
  try {
    await once(client,'open');
    let response=once(client,'message');client.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'slotSubscribe',params:[]}));
    assert.equal(JSON.parse((await response)[0]).result,123);
    response=once(client,'message');client.send(JSON.stringify({jsonrpc:'2.0',id:2,method:'sendTransaction',params:[]}));
    assert.equal(JSON.parse((await response)[0]).error.code,-32600);
    assert.deepEqual(forwarded,['slotSubscribe']);
  } finally {
    client.terminate();for(const socket of upstream.clients)socket.terminate();
    await Promise.all([new Promise(r=>preview.close(r)),new Promise(r=>upstream.close(r))]);
  }
});
