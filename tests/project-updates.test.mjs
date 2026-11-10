import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {createProjectUpdateRoutes} from '../server/routes/project-updates.mjs';
const key=()=>Keypair.generate().publicKey.toBase58();
function fixture(){
 const mint=key(),owner=key(),state={launches:{[mint]:{cluster:'devnet',creatorWallet:owner,onchainVerified:true,pumpFeeRoute:{verified:true}}}};
 let wallet=owner,input={},result,allow=true;
 const store={read:async()=>state,update:async fn=>fn(state),chargeRpcRate:async()=>allow};
 const route=createProjectUpdateRoutes({store,body:async()=>input,referralSession:async()=>wallet?{wallet}:null,cluster:'devnet',origin:'https://richpad.fun',respond:(res,status,data)=>{result={status,data};}});
 return {mint,owner,state,setWallet:value=>wallet=value,limit:()=>allow=false,
 request:async(method='GET',body={},origin='https://richpad.fun')=>{input=body;await route({method,headers:{origin}}, {},new URL(`https://richpad.fun/api/tokens/${mint}/updates`));return result;}};
}
test('only the authenticated original creator can publish; supplied author cannot impersonate',async()=>{
 const f=fixture(),payload={id:randomUUID(),text:'Roadmap progress',author:f.owner};
 f.setWallet(null);assert.equal((await f.request('POST',payload)).status,401);
 f.setWallet(key());assert.equal((await f.request('POST',payload)).status,403);
 f.setWallet(f.owner);assert.equal((await f.request('POST',payload,'https://evil.example')).status,403);
 assert.equal((await f.request('POST',payload)).status,201);assert.equal((await f.request()).data.updates[0].author,f.owner);
});
test('retry is idempotent, edits enforce version, and content remains plain text',async()=>{
 const f=fixture(),id=randomUUID();const text='<script>alert(1)</script>\nCreator update';
 assert.equal((await f.request('POST',{id,text})).status,201);
 assert.equal((await f.request('POST',{id,text})).status,200);assert.equal((await f.request()).data.updates.length,1);
 assert.equal((await f.request('POST',{id,text:'Changed',expectedVersion:0})).status,409);
 const changed=await f.request('POST',{id,text:'Changed',expectedVersion:1});assert.equal(changed.data.update.version,2);
 assert.equal((await f.request('POST',{id,text:'Stale',expectedVersion:1})).status,409);
});
test('wrong network, unverified launches, oversized input and rate limits fail closed',async()=>{
 const f=fixture();assert.equal((await f.request('POST',{id:randomUUID(),text:'a'.repeat(2001)})).status,400);
 f.limit();assert.equal((await f.request('POST',{id:randomUUID(),text:'Text'})).status,429);
 f.state.launches[f.mint].cluster='mainnet-beta';assert.equal((await f.request()).status,404);
 f.state.launches[f.mint].cluster='devnet';f.state.launches[f.mint].onchainVerified=false;assert.equal((await f.request()).status,404);
});
