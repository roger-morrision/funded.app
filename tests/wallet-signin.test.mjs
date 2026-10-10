import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletSignIn } from '../wallet-signin.js';

function fixture() {
  let time = 100_000, cookie = null, signatures = 0, reject = false, signGate = null;
  const calls = [];
  const provider = { async signMessage() { signatures++; if (signGate) await signGate; if (reject) throw Object.assign(new Error('User rejected'), {code:4001}); return new Uint8Array([1]); } };
  let session = {address:'A',provider,version:1};
  const auth = createWalletSignIn({ now:()=>time, assertCurrent:value=>{ assert.equal(value,session,'Wallet changed'); }, encodeSignature:()=> 'signature',
    async request(path, options) {
      calls.push(path);
      if (path.endsWith('/prepare')) return {available:true,data:{statement:'Sign in',challengeId:'challenge'}};
      if (path.endsWith('/verify')) cookie={wallet:options.body.wallet,expiresAt:time+3_600_000};
      if (path.endsWith('/logout')) { cookie=null; return {available:true}; }
      return {available:true,data:cookie && cookie.expiresAt>time ? {authenticated:true,...cookie} : {authenticated:false}};
    }
  });
  return {auth,calls,get session(){return session;},get signatures(){return signatures;},get cookie(){return cookie;},
    reject(){reject=true;}, advance(){time+=3_600_001;}, switchWallet(){session={address:'B',provider,version:2};auth.clear();},
    holdSignature(){ let release; signGate=new Promise(resolve=>{release=resolve;}); return release; }
  };
}

test('connection and concurrent page requests share one approval',async()=>{
  const f=fixture();
  await Promise.all([f.auth.ensure(f.session),f.auth.ensure(f.session,{interactive:true}),f.auth.ensure(f.session,{interactive:true})]);
  assert.equal(f.signatures,1);
  assert.equal(f.calls.filter(x=>x.endsWith('/verify')).length,1);
  await f.auth.ensure(f.session,{interactive:true});
  assert.equal(f.signatures,1,'Navigation reuses the signed-in session');
});
test('restoring a valid server session needs no new signature',async()=>{
  const f=fixture(); await f.auth.ensure(f.session,{interactive:true}); f.auth.clear();
  assert.equal(await f.auth.ensure(f.session,{interactive:true}),true); assert.equal(f.signatures,1);
});
test('declined connection approval is shared without repeated prompts',async()=>{
  const f=fixture(); f.reject();
  const results=await Promise.allSettled([f.auth.ensure(f.session,{interactive:true}),f.auth.ensure(f.session,{interactive:true})]);
  assert(results.every(x=>x.status==='rejected')); assert.equal(f.signatures,1); assert.equal(f.cookie,null);
});
test('switching wallets while signing never verifies the old account',async()=>{
  const f=fixture(), release=f.holdSignature();
  const pending=f.auth.ensure(f.session,{interactive:true});
  await new Promise(resolve=>setImmediate(resolve));
  f.switchWallet(); release(); await assert.rejects(pending,/Wallet changed/);
  assert.equal(f.cookie,null);
  await f.auth.ensure(f.session,{interactive:true}); assert.equal(f.cookie.wallet,'B');
});
test('expiry needs a fresh proof and logout removes the shared session',async()=>{
  const f=fixture(); await f.auth.ensure(f.session,{interactive:true}); f.advance();
  assert.equal(await f.auth.ensure(f.session),false);
  await f.auth.ensure(f.session,{interactive:true}); assert.equal(f.signatures,2);
  await f.auth.logout(); assert.equal(f.cookie,null); assert.equal(f.auth.ready(f.session),false);
});
test('logout waits for in-flight verification before clearing its cookie',async()=>{
  const f=fixture(), release=f.holdSignature();
  const pending=f.auth.ensure(f.session,{interactive:true});
  await new Promise(resolve=>setImmediate(resolve));
  const logout=f.auth.logout(); release(); await pending; await logout;
  assert.equal(f.cookie,null); assert.equal(await f.auth.ensure(f.session),false);
});
