import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {decodeRichAssets,readRichAssets,richAssetsAddress,buildConfigureRichAssets} from '../../rich-assets.js';
import {decodeBuybackRequest} from '../../server/price-signer-review.mjs';
import {createPrimaryRichReader} from '../../server/primary-rich.mjs';
import {createLaunchTierPricing} from '../../server/launch-tier-pricing.mjs';
import {loadPrimaryRichForApp} from '../../src/app/startup/primary-rich.js';
import {SOLANA_GENESIS} from '../../solana-network.js';

const key=()=>Keypair.generate().publicKey;
function account(program,mint=key(),pool=key(),revision=1n){
  const data=Buffer.alloc(113);Buffer.from('aac69639f52c60c5','hex').copy(data);
  mint.toBuffer().copy(data,8);pool.toBuffer().copy(data,40);TOKEN_PROGRAM_ID.toBuffer().copy(data,72);data.writeBigUInt64LE(revision,104);
  return{owner:program,executable:false,data};
}
test('RICH decoder rejects foreign owners, invalid layouts, token programs and revisions',()=>{
  const program=key(),valid=account(program),decode=info=>decodeRichAssets(info,{programId:program});
  assert.equal(decode(valid).revision,'1');
  assert.throws(()=>decode({...valid,owner:key()}));assert.throws(()=>decode({...valid,executable:true}));
  for(const length of [0,112,114])assert.throws(()=>decode({...valid,data:Buffer.alloc(length)}));
  for(const [offset,value] of [[0,0],[72,0],[104,0],[112,2]]){
    const data=Buffer.from(valid.data);data[offset]=value;assert.throws(()=>decode({...valid,data}));
  }
  assert.throws(()=>decodeRichAssets(valid,{programId:program,revision:2}));
});
test('current configuration switches while finalized immutable history still resolves old receipts',async()=>{
  const program=key(),first=account(program),second=account(program,key(),key(),2n);
  let current=first;const calls=[];
  const connection={getAccountInfo:async(address,commitment)=>{calls.push(commitment);
    return address.equals(richAssetsAddress(program))?current:address.equals(richAssetsAddress(program,1))?first:null;}};
  assert.equal((await readRichAssets(connection,program)).revision,'1');current=second;
  assert.equal((await readRichAssets(connection,program)).revision,'2');
  const historical=await readRichAssets(connection,program,{revision:1});
  assert.equal(historical.revision,'1');assert.notEqual(String(historical.mint),String((await readRichAssets(connection,program)).mint));
  assert(calls.every(value=>value==='finalized'));
  await assert.rejects(()=>readRichAssets(connection,program,{revision:3}));
});
test('owner update encodes next revision, canonical current/history accounts and owner-only signature',()=>{
  const program=key(),owner=key(),mint=key(),market=key();
  const ix=buildConfigureRichAssets({programId:program,owner,mint,market,venue:1,nextRevision:9});
  assert.equal(ix.data.subarray(0,8).toString('hex'),'340a47441468b59c');assert.equal(ix.data.readBigUInt64LE(8),9n);assert.equal(ix.data[16],1);
  assert(ix.keys[3].pubkey.equals(richAssetsAddress(program)));assert(ix.keys[4].pubkey.equals(richAssetsAddress(program,9)));
  assert.deepEqual(ix.keys.filter(k=>k.isSigner).map(k=>String(k.pubkey)),[String(owner)]);
  assert.throws(()=>buildConfigureRichAssets({programId:program,owner,mint,market,venue:2,nextRevision:1}));
});
test('configured buybacks bind revision in signed instruction bytes for both policy variants',()=>{
  for(const agency of [false,true]){
    const name=agency?'buyback_configured_agency_mint_v3':'buyback_configured_mint_v3';
    const data=Buffer.alloc(agency?130:72);createHash('sha256').update(`global:${name}`).digest().subarray(0,8).copy(data);
    if(agency){data[40]=6;data[41]=255;}
    const offset=agency?98:40;data.writeBigUInt64LE(10000n,offset);data.writeBigUInt64LE(1n,offset+8);data.writeBigUInt64LE(10000n,offset+16);
    data.writeBigUInt64LE(17n,data.length-8);const parsed=decodeBuybackRequest(data);
    assert.equal(parsed.configured,true);assert.equal(parsed.agency,agency);assert.equal(parsed.assetsRevision,'17');
    assert.throws(()=>decodeBuybackRequest(data.subarray(0,data.length-8)));
  }
});
test('production app assets ignore environment after activation and fail closed on missing configuration',async()=>{
  const program=key(),mint=key(),pool=key();let info=account(program,mint,pool);
  const get=createPrimaryRichReader({cluster:'mainnet-beta',fundedMint:String(key()),connection:{
    getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],getAccountInfo:async()=>info},release:{programId:String(program)}});
  const config=await get();assert.equal(config.fundedMint,String(mint));assert.equal(config.configuration,'onchain-v1');
  const release={programId:String(program)};
  const loaded=await loadPrimaryRichForApp('mainnet-beta',{release,request:async()=>({ok:true,json:async()=>config})});
  assert.equal(loaded.fundedMint,String(mint));
  info=null;await assert.rejects(get);
  assert.deepEqual(await loadPrimaryRichForApp('mainnet-beta',{release,request:async()=>{throw Error('offline');}}),{fundedMint:'',pool:null});
  assert.equal(await loadPrimaryRichForApp('devnet',{release,request:()=>{throw Error('must not request');}}),undefined);
});
test('tier pricing invalidates its cache on RICH revision or mint changes',async()=>{
  let revision='1',mint=String(key()),reads=0;const pool=String(key());
  const {currentLaunchTierPricing}=createLaunchTierPricing({solanaCluster:'mainnet-beta',getPrimaryRich:async()=>({fundedMint:mint,pool,revision,configuration:'onchain-v1'}),
    connectionFactory:()=>({getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta']}),
    readSolUsdQuote:async()=>({fetchedAt:new Date().toISOString(),priceUsd:100}),
    readMarket:async input=>{reads++;return{pool,slot:1,spotPriceSol:0.001,market:'pump-swap',mint:input.mint};}});
  assert.equal((await currentLaunchTierPricing()).richAssetsRevision,'1');await currentLaunchTierPricing();assert.equal(reads,1);
  revision='2';assert.equal((await currentLaunchTierPricing()).richAssetsRevision,'2');assert.equal(reads,2);
  mint=String(key());revision='3';assert.equal((await currentLaunchTierPricing()).fundedMint,mint);assert.equal(reads,3);
});
