import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createLaunchProtectionRoutes} from '../server/routes/launch-protection.mjs';
import {mint,creator} from './fixtures/developer-protection.mjs';
function fixture(options={}){
 const responses=[],launch={mint,creatorWallet:creator,cluster:'devnet',onchainVerified:true,...options.launch};let charged=0;
 const handler=createLaunchProtectionRoutes({store:{readLaunch:async()=>launch,chargeRpcRate:async()=>{charged++;return true;}},solanaCluster:'devnet',clientKey:()=> 'fixture',respond:(_,status,data)=>responses.push({status,data}),connectionFactory:()=>({}),...options});
 return {responses,handler,get charged(){return charged;},request:(scan=false,otherMint=mint)=>handler({method:'GET'}, {},new URL(`https://funded.vip/api/tokens/${otherMint}/launch-protection${scan?'?scan=1':''}`))};
}
test('legacy coins do not acquire invented custody and old creator fees have no hold',async()=>{
 const f=fixture();await f.request();assert.equal(f.responses[0].data.tokenLock.status,'not-required-for-legacy-launch');assert.equal(f.responses[0].data.tokenLock.verified,false);assert.equal(f.responses[0].data.creatorFeesLocked,false);assert.equal(f.charged,0);
});
test('lock unavailable errors do not leak RPC internals or claim verified custody',async()=>{
 const f=fixture({launch:{developerTokenLock:{verified:true,amount:'1'}},configReader:async()=>{throw Error('secret-provider-url');}});await f.request();assert.equal(f.responses[0].data.tokenLock.status,'unavailable');assert(!JSON.stringify(f.responses).includes('secret-provider-url'));
});
test('risk scans are single-flight, asynchronously cached and cannot be flooded across wallets',async()=>{
 let finish,calls=0;const f=fixture({scanner:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
 await Promise.all([f.request(true),f.request(true,Keypair.generate().publicKey.toBase58())]);assert.equal(calls,1);assert.equal(f.responses.filter(r=>r.status===429).length,1);
 await f.request();assert.equal(f.responses.at(-1).data.bundleDetection.scanning,true);
 finish({status:'no-indicators-in-scanned-data',bundleConfirmed:false,coverage:{status:'partial'}});await new Promise(r=>setImmediate(r));
 await f.request(true);assert.equal(calls,1);assert.equal(f.responses.at(-1).data.bundleDetection.coverage.status,'partial');assert.equal(f.responses.at(-1).data.bundleDetection.scanning,false);
});
test('failed scanners report unavailable rather than no indicators; non-Devnet is rejected',async()=>{
 const f=fixture({scanner:async()=>{throw Error('private upstream');}});await f.request(true);await new Promise(r=>setImmediate(r));await f.request();assert.equal(f.responses.at(-1).data.bundleDetection.status,'unavailable');assert(!JSON.stringify(f.responses).includes('private upstream'));
 const mainnet=fixture({solanaCluster:'mainnet-beta'});await mainnet.request(true);assert.equal(mainnet.responses[0].status,503);
});
