import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair} from '@solana/web3.js';
import {createStore} from '../server/store.mjs';
import {createAccountPreferencesHandler,updateAccountPreferences,emptyPreferences} from '../server/account-preferences.mjs';
const a=Keypair.fromSeed(Buffer.alloc(32,181)).publicKey.toBase58(),b=Keypair.fromSeed(Buffer.alloc(32,182)).publicKey.toBase58();
test('wallet account saves persist, combine concurrent devices, and stay private across wallets and clusters',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'funded-cloud-preferences-'));
  try{
    const file=join(dir,'store.json'),store=createStore(file,null);
    let session={wallet:a};
    const handler=createAccountPreferencesHandler({store,cluster:'devnet',origin:'https://funded.vip',getWalletSession:async()=>session});
    const request=async(wallet,body,headers={})=>{
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=body?'POST':'GET';req.headers={cookie:'funded_referral_session=test',origin:'https://funded.vip','content-type':'application/json',...headers};
      const res={writeHead(code){this.status=code;},end(value){this.data=JSON.parse(value);},setHeader(){}};
      await handler(req,res,new URL(`https://funded.vip/api/account-preferences?wallet=${wallet}`));return res;
    };
    assert.equal((await request(b)).status,401);
    const first=await request(a);assert.deepEqual(first.data.preferences,emptyPreferences());
    const headers={'x-preferences-csrf':first.data.csrf};
    assert.equal((await request(a,{wallet:a,kind:'wallets',action:'add',item:{address:b,roles:['trader']}})).status,403);
    const updates=await Promise.all([
      request(a,{wallet:a,kind:'wallets',action:'add',item:{address:b,roles:['trader']}},headers),
      request(a,{wallet:a,kind:'creators',action:'add',item:'123'},headers),
    ]);
    assert.ok(updates.every(result=>result.status===200),JSON.stringify(updates.map(row=>({status:row.status,data:row.data}))));
    const restart=createStore(file,null),saved=await restart.readWatchlist(`wallet:${a}`,'devnet');
    assert.equal(saved.preferences.wallets[0].address,b);assert.deepEqual(saved.preferences.creators,['123']);
    assert.equal((await restart.readWatchlist(`wallet:${a}`,'mainnet-beta')).preferences,undefined);
    assert.equal((await request(a,{wallet:b,kind:'creators',action:'add',item:'999'},headers)).status,409);
    assert.equal((await request(a,{wallet:a,kind:'creators',action:'add',item:'999'},{...headers,origin:'https://untrusted.example'})).status,403);
    session={wallet:b};assert.equal((await request(a)).status,401);assert.deepEqual((await request(b)).data.preferences,emptyPreferences());
    session=null;assert.equal((await request(b)).status,401);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('account preferences reject invalid routes, oversized lists, and unknown operations',()=>{
  assert.throws(()=>updateAccountPreferences(null,{kind:'reminders',action:'add',item:{id:'a'.repeat(36),at:Date.now(),label:'x',href:'javascript:alert(1)'}}));
  assert.throws(()=>updateAccountPreferences(null,{kind:'secret',action:'add',item:'x'}));
  const row={...emptyPreferences(),creators:Array.from({length:200},(_,i)=>String(i+1))};
  assert.throws(()=>updateAccountPreferences(row,{kind:'creators',action:'add',item:'999'}));
  const next=updateAccountPreferences(row,{kind:'creators',action:'remove',id:'1'});assert.equal(next.creators.length,199);
});
