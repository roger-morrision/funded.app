import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

for (const enabled of [false,true]) test(`public trade HTTP consent ${enabled?'requires exact origin, signed purpose and finalized proof':'defaults to disabled'}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'x-consent-http-'));
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),stdio:'ignore',env:{...process.env,FUNDED_SKIP_LOCAL_ENV:'true',NODE_ENV:'test',DATABASE_URL:'',HOST:'127.0.0.1',PORT:String(port),FUNDED_STORE_PATH:join(directory,'state.json'),VITE_SOLANA_CLUSTER:'devnet',SOLANA_CLUSTER:'devnet',SOLANA_RPC_URL:'http://127.0.0.1:9',DEV_MODE:'false',DEVNET_TEST_MODE:'false',X_PUBLIC_TRADE_SHARES_ENABLED:String(enabled),X_POST_PUBLIC_ORIGIN:'https://funded.vip',X_POST_EXPECTED_HANDLE:'johntrand83'}});
  const base=`http://127.0.0.1:${port}`, origin='https://funded.vip';
  try {
    let ready=false;for(let i=0;i<60;i++){try{if((await fetch(`${base}/api/x-public-trade-shares/config`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
    assert.equal((await (await fetch(`${base}/api/x-public-trade-shares/config`)).json()).enabled,enabled);
    const post=(path,body,from=origin)=>fetch(`${base}/api/x-public-trade-shares/${path}`,{method:'POST',headers:{'content-type':'application/json',...(from?{origin:from}:{})},body:JSON.stringify(body)});
    if(!enabled){assert.equal((await post('challenge',{})).status,404);return;}
    assert.equal((await post('challenge',{},'')).status,403);
    assert.equal((await post('challenge',{},'https://attacker.org')).status,403);
    const signer=nacl.sign.keyPair(),input={wallet:bs58.encode(signer.publicKey),mint:bs58.encode(new Uint8Array(32).fill(9)),buySignature:bs58.encode(new Uint8Array(64).fill(8)),sellSignature:bs58.encode(new Uint8Array(64).fill(7))};
    const response=await post('challenge',input);assert.equal(response.status,201);const prepared=await response.json();
    assert.match(prepared.statement,/X account: @johntrand83/);assert.match(prepared.statement,/Origin: https:\/\/funded.vip/);
    assert.equal((await post('consent',{challengeId:prepared.challengeId,signature:input.buySignature})).status,403);
    const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(prepared.statement),signer.secretKey));
    const unverified=await post('consent',{challengeId:prepared.challengeId,signature});assert.equal(unverified.status,422);assert.doesNotMatch(JSON.stringify(await unverified.json()),/127.0.0.1|ECONNREFUSED/);
    assert.equal((await post('challenge',{padding:'a'.repeat(5000)})).status,413);
    await post('challenge',input);await post('challenge',input);
    assert.equal((await post('challenge',input)).status,429);
  } finally {if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}await rm(directory,{recursive:true,force:true});}
});
