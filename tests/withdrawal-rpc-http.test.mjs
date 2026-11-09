import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('actual Devnet proxy permits withdrawal blockhash checks and never reuses an expired validity result',{timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-withdrawal-rpc-'));
  const forwarded=[];let valid=true;
  const upstream=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body);forwarded.push(request);
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{context:{slot:123},value:valid}}));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','USERPROFILE','HOME','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',FUNDED_SKIP_LOCAL_ENV:'true',FUNDED_API_ONLY:'true',
    SOLANA_CLUSTER:'devnet',VITE_SOLANA_CLUSTER:'devnet',FUNDED_RPC_GATEWAY_ENABLED:'false',
    FUNDED_STORE_PATH:join(directory,'store.json'),AUTOMATIC_REWARD_STORE_PATH:join(directory,'rewards.json'),
    SOLANA_RPC_URL:`http://127.0.0.1:${upstream.address().port}`,CORS_ORIGIN:'http://localhost'});
  const child=spawn(process.execPath,['server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');let log='';
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Withdrawal fixture did not start: '+log.slice(-1200))),10000);
      child.stderr.on('data',bytes=>{log+=bytes.toString();});
      child.stdout.on('data',bytes=>{log+=bytes.toString();const match=log.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Withdrawal fixture exited: '+log.slice(-1200)));});
    });
    const request={jsonrpc:'2.0',id:41,method:'isBlockhashValid',params:['11111111111111111111111111111111',{commitment:'confirmed'}]};
    const call=()=>fetch(`http://127.0.0.1:${port}/api/solana/rpc`,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(request)});
    let response=await call();assert.equal(response.status,200);assert.equal((await response.json()).result.value,true);
    valid=false;response=await call();assert.equal(response.status,200);assert.equal((await response.json()).result.value,false);
    assert.deepEqual(forwarded,[request,request]);
    request.method='unapprovedRpcMethod';response=await call();assert.equal(response.status,400);assert.equal(forwarded.length,2);
  }finally{
    child.kill();await exited;upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
