import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';

test('actual Mainnet API and WebSocket reject writes while forwarding read subscriptions', {timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-mainnet-readonly-'));
  const upstream=new WebSocketServer({host:'127.0.0.1',port:0});await once(upstream,'listening');
  const forwarded=[];
  upstream.on('connection',socket=>socket.on('message',bytes=>{
    const request=JSON.parse(bytes.toString());forwarded.push(request);
    socket.send(JSON.stringify({jsonrpc:'2.0',id:request.id,result:7}));
  }));
  const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','USERPROFILE','HOME','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',FUNDED_SKIP_LOCAL_ENV:'true',FUNDED_API_ONLY:'true',
    SOLANA_CLUSTER:'mainnet-beta',VITE_SOLANA_CLUSTER:'mainnet-beta',VITE_ALLOW_MAINNET:'true',
    FUNDED_STORE_PATH:join(directory,'store.json'),AUTOMATIC_REWARD_STORE_PATH:join(directory,'rewards.json'),
    SOLANA_RPC_URL:`http://127.0.0.1:${upstream.address().port}`,CORS_ORIGIN:'http://localhost'});
  // Port 0 lets the OS allocate a free loopback port. The listener reports it.
  const child=spawn(process.execPath,['server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});
  let log='',socket;
  const exited=once(child,'exit');
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Mainnet fixture did not start: '+log.slice(-1200))),10000);
      child.stderr.on('data',bytes=>{log+=bytes.toString();});
      child.stdout.on('data',bytes=>{log+=bytes.toString();const match=log.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Mainnet fixture exited: '+log.slice(-1200)));});
    });
    assert(port>0);const origin=`http://127.0.0.1:${port}`;
    for(const path of ['/api/launches','/api/token-metadata','/api/admin/settings','/api/mobile-wallet/relay']){
      const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      assert.equal(response.status,403,path);assert.match((await response.json()).error,/Mainnet is read-only/);
    }
    for(const method of ['sendTransaction','requestAirdrop']){
      const response=await fetch(origin+'/api/solana/rpc',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:['signed-test-wire']})});
      assert([400,403].includes(response.status));
    }
    socket=new WebSocket(origin.replace('http:','ws:')+'/api/solana/ws',{origin:'http://localhost'});await once(socket,'open');
    const exchange=async request=>{const message=once(socket,'message');socket.send(JSON.stringify(request));return JSON.parse((await message)[0].toString());};
    assert.equal((await exchange({jsonrpc:'2.0',id:10,method:'sendTransaction',params:['signed-test-wire']})).error.code,-32600);
    assert.equal((await exchange([{jsonrpc:'2.0',id:11,method:'sendTransaction',params:['wire']}])).error.code,-32600);
    assert.equal((await exchange({jsonrpc:'2.0',id:12,method:'signatureSubscribe',params:['public-signature',{commitment:'finalized'}]})).result,7);
    assert.deepEqual(forwarded.map(row=>row.method),['signatureSubscribe']);
  }finally{
    socket?.terminate();child.kill();await exited;
    for(const client of upstream.clients)client.terminate();await new Promise(resolve=>upstream.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
