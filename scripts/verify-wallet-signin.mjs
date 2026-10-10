import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const root=resolve('tmp'); await mkdir(root,{recursive:true});
const directory=await mkdtemp(join(root,'shared-wallet-test-'));
const probe=createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port; await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`;
const blank={SOLANA_KEEPER_SECRET_KEY:'',SOLANA_KEEPER_KEYPAIR_PATH:'',SOLANA_REFERRAL_PAYOUT_SECRET_KEY:'',SOLANA_REFERRAL_PAYOUT_KEYPAIR_PATH:'',FUNDED_ROUTER_AUTHORITY_SECRET_KEY:'',FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'',SOLANA_DEVNET_CREATOR_SECRET_KEY:'',SOLANA_DEVNET_REFERRER_SECRET_KEY:'',SOLANA_DEVNET_CLAIMANT_SECRET_KEY:''};
const child=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,...blank,FUNDED_SKIP_LOCAL_ENV:'true',NODE_ENV:'test',DEV_MODE:'false',DEVNET_TEST_MODE:'false',HOST:'127.0.0.1',PORT:String(port),FUNDED_STORE_PATH:join(directory,'state.json'),DATABASE_URL:'',FUNDED_API_TOKEN:'local-shared-session-test',SOLANA_ALLOW_KEEPER_TRANSFER:'false',CORS_ORIGIN:base,VITE_SOLANA_CLUSTER:'devnet'},stdio:'ignore'});
async function request(path,{body,cookie,origin=base,...options}={}) {
  const response=await fetch(base+path,{...options,method:body?'POST':options.method||'GET',headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...options.headers},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function signIn(key) {
  const wallet=key.publicKey.toBase58();
  const challenge=await request('/api/referrals/session/prepare',{body:{wallet}}); assert.equal(challenge.status,200);
  assert.match(challenge.data.statement,/Sign in to funded.vip/);
  const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.data.statement),key.secretKey));
  const signed=await request('/api/referrals/session/verify',{body:{wallet,challengeId:challenge.data.challengeId,signature}});
  assert.equal(signed.status,200); assert(signed.cookie); assert(signed.data.expiresAt>Date.now()); return signed.cookie;
}
try {
  for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(i===59)throw Error('Isolated API did not start');await new Promise(r=>setTimeout(r,100));}
  const a=Keypair.generate(), b=Keypair.generate(), wallet=a.publicKey.toBase58(), other=b.publicKey.toBase58();
  const cookie=await signIn(a);
  for(const path of [`/api/referrals/dashboard?wallet=${wallet}`,`/api/referral-claims?wallet=${wallet}`]) assert.equal((await request(path,{cookie})).status,200);
  assert.equal((await request(`/api/referrals/dashboard?wallet=${other}`,{cookie})).status,401);
  const challenge=await request('/api/referrals/registration/prepare',{body:{wallet}});
  const body={wallet,challengeId:challenge.data.challengeId,useWalletSession:true};
  assert.equal((await request('/api/referrals/registration/verify',{body})).status,401);
  assert.equal((await request('/api/referrals/registration/verify',{body,cookie,origin:'https://other.example'})).status,403);
  const registered=await request('/api/referrals/registration/verify',{body,cookie}); assert.equal(registered.status,200); assert(registered.data.code);
  const chatHeaders={'x-token-chat-session':'wallet'};
  for(let i=0;i<2;i++) {
    const mint=Keypair.generate().publicKey.toBase58(), path=`/api/tokens/${mint}/chat`;
    assert.equal((await request(path,{headers:chatHeaders,body:{author:wallet,text:'No session'}})).status,401);
    assert.equal((await request(path,{cookie,origin:'https://other.example',headers:chatHeaders,body:{author:wallet,text:'Wrong origin'}})).status,403);
    assert.equal((await request(path,{cookie,headers:chatHeaders,body:{author:other,text:'Wrong account'}})).status,401);
    const posted=await request(path,{cookie,headers:chatHeaders,body:{author:wallet,text:`Shared session token ${i}`}}); assert.equal(posted.status,201);
    assert.equal((await request(path+'/delete',{cookie,headers:chatHeaders,body:{author:wallet,messageId:posted.data.message.id}})).status,200);
  }
  const otherCookie=await signIn(b);
  const attribution=await request('/api/referrals/attribution/prepare',{body:{wallet:other,code:registered.data.code}});
  const link={wallet:other,challengeId:attribution.data.challengeId,useWalletSession:true};
  assert.equal((await request('/api/referrals/attribution/verify',{cookie,body:link})).status,401);
  const linked=await request('/api/referrals/attribution/verify',{cookie:otherCookie,body:link}); assert.equal(linked.status,200); assert.equal(linked.data.inviterWallet,wallet);
  assert.equal((await request('/api/referrals/session/logout',{cookie,method:'POST'})).status,200);
  assert.equal((await request('/api/referrals/session',{cookie})).status,401);
  assert.equal((await request(`/api/tokens/${Keypair.generate().publicKey.toBase58()}/chat`,{cookie,headers:chatHeaders,body:{author:wallet,text:'Logged out'}})).status,401);
  console.log('Shared wallet HTTP checks passed: one proof per wallet, referral reads/setup, two token discussions, cross-wallet/origin denial, and logout. Local-only; ephemeral keys; no transactions.');
} finally {
  if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  if(!resolve(directory).startsWith(root+sep))throw Error('Test cleanup escaped workspace tmp');
  await rm(directory,{recursive:true,force:true});
}
