import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Actual API entrypoint and HTTP stack; only its RPC dependency is a test-owned
// loopback server returning unavailable. No inherited credentials/local env,
// production data, wallet keys, provider traffic or financial workers.
export async function apiEntrypointFixture(t,{cluster='devnet',clientCluster=cluster,nonProgram=false}={}){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-entrypoint-'));
  const methods=[];let financialRpc=0,child,exit,stdout='',stderr='';
  const rpc=createServer(async(req,res)=>{
    let body='';for await(const chunk of req){body+=chunk;assert(body.length<100000);}
    const request=JSON.parse(body);methods.push(request.method);
    if(['sendTransaction','requestAirdrop','simulateTransaction'].includes(request.method))financialRpc++;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32000,message:'Offline fixture has no verified chain'}}));
  });
  await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
  const clean=Object.fromEntries(['PATH','Path','SYSTEMROOT','SystemRoot','TEMP','TMP','HOME','USERPROFILE'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
  const env={...clean,NODE_ENV:'test',FUNDED_SKIP_LOCAL_ENV:'true',SOLANA_CLUSTER:cluster,VITE_SOLANA_CLUSTER:clientCluster,
    FUNDED_STORE_PATH:join(dir,'store.json'),AUTOMATIC_REWARD_STORE_PATH:join(dir,'rewards.json'),
    SOLANA_RPC_URL:'http://127.0.0.1:'+rpc.address().port,HOST:'127.0.0.1',PORT:'0',DEV_MODE:'false',DEVNET_TEST_MODE:'false',
    FUNDED_API_ONLY:'true',FUNDED_LIVE_DATA:'false',FUNDED_MAINNET_NON_PROGRAM_WRITES:String(nonProgram),
    FUNDED_ADMIN_JWT_SECRET:'test-only-nonproduction-entrypoint-session-hmac',FUNDED_BUILD_ID:'entrypoint-offline-fixture'};
  child=spawn(process.execPath,[fileURLToPath(new URL('../../server/index.mjs',import.meta.url))],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  exit=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject);});
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');
    let timer;try{await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('API fixture shutdown timeout')),10000);})]);}
    finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}}};
  t.after(async()=>{await stop();rpc.closeAllConnections();await new Promise(resolve=>rpc.close(resolve));
    const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const listening=async()=>{
    for(let i=0;i<400;i++){
      const match=/app listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);if(match)return 'http://127.0.0.1:'+match[1];
      if(child.exitCode!==null||child.signalCode!==null)throw Error('API exited before listen: '+stdout+stderr);
      await new Promise(resolve=>setTimeout(resolve,25));
    }throw Error('API did not listen: '+stdout+stderr);
  };
  return {listening,exit,stop,methods,get financialRpc(){return financialRpc;},get stdout(){return stdout;},get stderr(){return stderr;},
    request:async(origin,path,options)=>{const r=await fetch(origin+path,{...options,signal:AbortSignal.timeout(15000)});return {status:r.status,body:await r.json()};}};
}
