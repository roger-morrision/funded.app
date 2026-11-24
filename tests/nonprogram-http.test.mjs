import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Keypair,PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createStore} from '../server/store.mjs';
import {createAdminJwt} from '../server/admin-jwt.mjs';
import {createReferralAuth} from '../server/referral-auth.mjs';
import {cookieValue} from '../server/x-auth.mjs';
import {readJsonBody} from '../server/request-body.mjs';
import {createReferralIdentityRoutes} from '../server/routes/referral-identity.mjs';
import {createAdminBoostRoute} from '../server/routes/admin-boost.mjs';
import {createAdminListingRoutes} from '../server/routes/admin-listing.mjs';
import {createWatchlistHandler} from '../server/watchlists.mjs';
import {createReferralCode} from '../referral-program.js';
import {SOLANA_GENESIS} from '../solana-network.js';

// Real HTTP, signatures, cookies and persistence; mocked Solana mint metadata.
// Ephemeral keys stay in memory. No chain transactions or production credentials.
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'richpad-nonprogram-'));
  const store=createStore(join(dir,'state.json'),''),admin=Keypair.generate(),user=Keypair.generate();
  const mint=Keypair.generate().publicKey.toBase58(),cluster='devnet';
  const env={FUNDED_ADMIN_WALLETS:String(admin.publicKey),FUNDED_ADMIN_JWT_SECRET:randomBytes(32).toString('hex')};
  const jwt=createAdminJwt({store,env,cluster});await jwt.ready;
  const auth=createReferralAuth(store),session=req=>auth.session(cookieValue(req,'funded_referral_session'));
  let origin,verified=true;
  const respond=(res,status,data)=>res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify(data));
  const shared={body:readJsonBody,store,solanaCluster:cluster,clientKey:()=> 'local-fixture',respond,env,adminJwt:jwt};
  const watchOptions={store,cluster,getSession:async()=>null,getWalletSession:session};
  const handlers=[createReferralIdentityRoutes({...shared,referralSession:session,referralAuth:auth,
    walletKey:v=>new PublicKey(v).toBase58(),requestCookieUrl:()=>origin,id:()=>randomUUID(),
    referralChallengeStatement:c=>`funded.app referral ${c.action} ${c.wallet} nonce ${c.nonce}`,
    walletSignature:v=>bs58.decode(v),referralCodeFromBytes:()=>createReferralCode(randomBytes(6))}),
  createAdminBoostRoute({...shared,mintVerified:async()=>verified}),
  createAdminListingRoutes({...shared,solanaRpcUrl:'http://unused.invalid',
    connectionFactory:()=>({getGenesisHash:async()=>SOLANA_GENESIS[cluster]}),
    readListingMint:async()=>{if(!verified)throw Error('Unverified mint');return {name:'QA token',symbol:'QA',source:'mocked',decimals:6};}})];
  const server=createServer(async(req,res)=>{try{
    for(const handler of handlers)if(await handler(req,res,new URL(req.url,origin),'fixture'))return;
    respond(res,404,{error:'Not found'});
  }catch(error){respond(res,500,{error:error.message});}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  env.CORS_ORIGIN=origin;handlers.push(createWatchlistHandler({...watchOptions,origin}));
  const prior=process.env.CORS_ORIGIN;process.env.CORS_ORIGIN=origin;
  t.after(async()=>{if(prior===undefined)delete process.env.CORS_ORIGIN;else process.env.CORS_ORIGIN=prior;
    server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  function client(){const cookies=new Map();return async(path,body,extra={})=>{
    const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',
      headers:{origin,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
    return {status:response.status,data:await response.json()};
  };}
  async function login(request,key){const wallet=String(key.publicKey);
    const challenge=await request('/api/referrals/session/prepare',{wallet});assert.equal(challenge.status,200);
    const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.data.statement),key.secretKey));
    const result=await request('/api/referrals/session/verify',{wallet,challengeId:challenge.data.challengeId,signature});assert.equal(result.status,200);return result.data;
  }
  return {store,admin,user,mint,client,login,verify:value=>{verified=value;},dir};
}

test('nonprogram admin sign-in, free listing and stacked boosts persist and reject unauthorized or duplicate writes',async t=>{
  const f=await fixture(t),request=f.client(),anonymous=f.client();
  for(const path of ['/api/listings/admin','/api/boosts/admin'])assert.equal((await anonymous(path,{mint:f.mint,packageId:'10x'})).status,401);
  assert.equal((await f.login(request,f.admin)).admin,true);
  assert.equal((await request('/api/auth/admin')).data.admin,true);
  f.verify(false);assert.equal((await request('/api/listings/admin',{mint:f.mint})).status,409);
  f.verify(true);const listing=await request('/api/listings/admin',{mint:f.mint});assert.equal(listing.status,201);
  assert.equal(listing.data.adminListing,true);assert.equal(listing.data.usd,0);
  assert.equal((await request('/api/listings/admin',{mint:f.mint})).status,409);
  assert.equal((await request('/api/boosts/admin',{mint:f.mint,packageId:'bad'})).status,400);
  for(let i=0;i<2;i++){const boost=await request('/api/boosts/admin',{mint:f.mint,packageId:'10x'});
    assert.equal(boost.status,201);assert.equal(boost.data.lamports,0);assert.equal(boost.data.adminBoost,true);}
  const state=await createStore(join(f.dir,'state.json'),'').read();
  assert.equal(state.listings[f.mint].adminListing,true);
  assert.equal(Object.values(state.boostReceipts).filter(r=>r.mint===f.mint).length,2);
  assert.equal(Object.keys(state.adminAudit).length,3);
  assert.equal((await request('/api/referrals/session/logout',{})).status,200);
  assert.equal((await request('/api/boosts/admin',{mint:f.mint,packageId:'10x'})).status,401);
});

test('nonprogram wallet favorites persist, deduplicate, remove and isolate accounts with CSRF protection',async t=>{
  const f=await fixture(t),request=f.client();await f.login(request,f.user);
  const accountId=`wallet:${f.user.publicKey}`,path='/api/watchlist?accountId='+encodeURIComponent(accountId);
  const first=await request(path);assert.equal(first.status,200);assert.deepEqual(first.data.mints,[]);
  const input={accountId,action:'add',mint:f.mint},headers={'x-watchlist-csrf':first.data.csrf};
  assert.equal((await request(path,input)).status,403);
  for(let i=0;i<2;i++)assert.deepEqual((await request(path,input,headers)).data.mints,[f.mint]);
  assert.deepEqual((await createStore(join(f.dir,'state.json'),'').readWatchlist(accountId,'devnet')).mints,[f.mint]);
  assert.equal((await request('/api/watchlist?accountId=wallet:'+f.admin.publicKey)).status,401);
  assert.deepEqual((await request(path,{...input,action:'remove'},headers)).data.mints,[]);
});

test('nonprogram referral link attribution persists first touch and rejects self referral and replay',async t=>{
  const f=await fixture(t),inviter=f.client(),invitee=f.client();await f.login(inviter,f.admin);await f.login(invitee,f.user);
  const wallet=String(f.admin.publicKey),prepared=await inviter('/api/referrals/registration/prepare',{wallet});assert.equal(prepared.status,200);
  const registered=await inviter('/api/referrals/registration/verify',{wallet,challengeId:prepared.data.challengeId,useWalletSession:true});
  assert.equal(registered.status,200);const code=registered.data.code,link=new URL('https://richpad.fun/?ref='+code);
  assert.equal((await inviter('/api/referrals/attribution/prepare',{wallet,code})).status,400);
  const referred=String(f.user.publicKey),challenge=await invitee('/api/referrals/attribution/prepare',{wallet:referred,code:link.searchParams.get('ref'),source:'copy'});
  assert.equal(challenge.status,200);const input={wallet:referred,challengeId:challenge.data.challengeId,useWalletSession:true};
  const attributed=await invitee('/api/referrals/attribution/verify',input);assert.equal(attributed.status,200);
  assert.equal(attributed.data.inviterWallet,wallet);assert.equal(attributed.data.lock,'first-touch');
  assert.equal((await invitee('/api/referrals/attribution/verify',input)).status,409);
  const state=await createStore(join(f.dir,'state.json'),'').read();assert.equal(state.referrals.attributions[referred].inviterCode,code);
});
