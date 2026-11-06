import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {readMainnetProgramEvidence,readMainnetServicePolicy,assessMainnetConfig} from '../scripts/mainnet-readiness-preflight.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
function fixture(){
 const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),authority=Keypair.generate().publicKey;
 const programs=Array.from({length:3},()=>({id:Keypair.generate().publicKey,dataId:Keypair.generate().publicKey}));
 const accounts=new Map();
 for(const row of programs){const header=Buffer.alloc(36);header.writeUInt32LE(2);row.dataId.toBuffer().copy(header,4);
  const bytes=Buffer.alloc(60);bytes.writeUInt32LE(3);bytes[12]=1;authority.toBuffer().copy(bytes,13);
  row.hash=createHash('sha256').update(bytes).digest('hex');
  accounts.set(row.id.toBase58(),{executable:true,owner:loader,data:header});accounts.set(row.dataId.toBase58(),{executable:false,owner:loader,data:bytes});}
 const env={SOLANA_RPC_URL:'https://mainnet.helius-rpc.com/?api-key=never-log-this',
  FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programs[1].id.toBase58(),FUNDED_V3_PROGRAM_DATA_SHA256:programs[1].hash,
  FUNDED_DEVELOPER_LOCK_PROGRAM_ID:programs[2].id.toBase58(),FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:programs[2].hash};
 const config={configurationComplete:true,routerId:programs[0].id.toBase58(),hash:programs[0].hash,authority:authority.toBase58(),immutable:false};
 let reads=0;
 const connection={getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],getAccountInfo:async(key,commitment)=>{reads++;assert.equal(commitment,'finalized');return accounts.get(key.toBase58());}};
 return {env,config,connection,programs,accounts,reads:()=>reads};
}
test('read-only preflight verifies exact bytes and authorities for all three program roles',async()=>{
 const f=fixture(),result=await readMainnetProgramEvidence(f.env,f.config,{connectionFactory:()=>f.connection});
 assert.equal(result.status,'verified');assert.equal(f.reads(),6);assert.deepEqual(result.programs.map(p=>p.role),['reward-router','v3-router','developer-escrow']);
 assert(!JSON.stringify(result).includes('never-log-this'));
});
test('wrong RPC genesis stops before account reads; incomplete config does not connect',async()=>{
 const f=fixture();f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
 assert.equal((await readMainnetProgramEvidence(f.env,f.config,{connectionFactory:()=>f.connection})).status,'blocked');assert.equal(f.reads(),0);
 assert.equal((await readMainnetProgramEvidence(f.env,{configurationComplete:false},{connectionFactory:()=>assert.fail('Must not connect')})).status,'blocked');
});
for(const fault of ['hash','authority','header','owner'])test(`escrow ${fault} mismatch blocks whole program inventory`,async()=>{
 const f=fixture(),data=f.accounts.get(f.programs[2].dataId.toBase58());
 if(fault==='hash')f.env.FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256='0'.repeat(64);
 if(fault==='authority')Keypair.generate().publicKey.toBuffer().copy(data.data,13);
 if(fault==='header')data.data[12]=2;
 if(fault==='owner')data.owner=Keypair.generate().publicKey;
 const result=await readMainnetProgramEvidence(f.env,f.config,{connectionFactory:()=>f.connection});
 assert.notEqual(result.status,'verified');
});

function policyFixture(){
 const f=fixture(),owner=f.config.authority;
 const env={...f.env,VITE_SOLANA_CLUSTER:'mainnet-beta',SOLANA_CLUSTER:'mainnet-beta',VITE_MAINNET_READ_ONLY:'true',MAINNET_APP_ORIGIN:'https://mainnet-preview.example.org',
  FUNDED_FEE_ROUTER_PROGRAM_ID:f.config.routerId,VITE_FUNDED_FEE_ROUTER_PROGRAM_ID:f.config.routerId,
  FUNDED_REWARD_PROGRAM_DATA_SHA256:f.config.hash,MAINNET_APPROVED_UPGRADE_AUTHORITY:owner,
  FUNDED_TRADE_FEE_OWNER:owner,VITE_FUNDED_TRADE_FEE_OWNER:owner,FUNDED_TOKEN_MINT:owner,VITE_FUNDED_TOKEN_MINT:owner,
  METADATA_STORAGE:'pinata',PINATA_JWT_FILE:'/run/secrets/metadata',DATABASE_URL:'postgres://fixture@db/mainnet',DEVNET_DATABASE_URL:'postgres://fixture@db/devnet',
  DEVNET_SOLANA_RPC_URL:'https://devnet.helius-rpc.com/?api-key=not-a-real-key'};
 assert.equal(assessMainnetConfig(env).configurationComplete,true);
 const body={cluster:'mainnet-beta',policy:{tradeBps:100},revision:1,tradeRecipient:owner};
 const hash=b=>createHash('sha256').update(JSON.stringify({policy:b.policy,revision:b.revision})).digest('hex');body.hash=hash(body);
 return {env,body,hash};
}
test('online policy verification reads saved fee policy instead of trusting the build default',async()=>{
 const f=policyFixture(),fetchImpl=async(url,options)=>{assert.equal(url,f.env.MAINNET_APP_ORIGIN+'/api/service-fees');assert.equal(options.redirect,'error');return Response.json(f.body);};
 assert.equal((await readMainnetServicePolicy(f.env,{fetchImpl})).status,'verified');
 f.body.policy.tradeBps=300;f.body.hash=f.hash(f.body);
 const result=await readMainnetServicePolicy(f.env,{fetchImpl});assert.equal(result.status,'blocked');assert.equal(result.checks.tradingFeeOnePercent,false);
});
for(const fault of ['cluster','recipient','hash'])test(`public Mainnet policy rejects ${fault} mismatch`,async()=>{
 const f=policyFixture();if(fault==='cluster')f.body.cluster='devnet';if(fault==='recipient')f.body.tradeRecipient=Keypair.generate().publicKey.toBase58();if(fault==='hash')f.body.hash='0'.repeat(64);
 const result=await readMainnetServicePolicy(f.env,{fetchImpl:async()=>Response.json(f.body)});assert.equal(result.status,'blocked');
});
