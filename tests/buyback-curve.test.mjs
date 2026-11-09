import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,MintLayout} from '@solana/spl-token';
import {PUMP_SDK,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {readBuybackCurve,quoteCurveBuyback,validateCurveBuy,bondingCurvePda} from '../server/v3-buyback-curve.mjs';
import {quoteV3Buyback} from '../server/v3-buyback-quote.mjs';
import {buildV3BuybackInstruction} from '../server/v3-buyback-instruction.mjs';
import {v3BuybackFeeSetup} from '../server/v3-buyback-setup.mjs';
import {V3_DEVNET_FUNDED_MINT as mint} from '../server/buyback-assets.mjs';
import {deriveMintVaultsV3} from '../mint-router-v3.js';
import {deriveAgencyVaultsV3} from '../agency-mint-router-v3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {loadFinalizedV3Buyback} from '../server/v3-buyback-proof.mjs';

const programId=new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const sourceMint=Keypair.generate().publicKey,authority=Keypair.generate().publicKey;
const priceSigner=Keypair.generate().publicKey;
const idl=PUMP_SDK.offlinePumpProgram.idl;
function zero(type){
  if(type==='pubkey')return PublicKey.default;
  if(type==='bool')return false;
  if(['u64','u128','i64'].includes(type))return new BN(0);
  if(typeof type==='string')return 0;
  if(type.array)return Array.from({length:type.array[1]},()=>zero(type.array[0]));
  if(type.vec)return [];
  return blank(type.defined.name);
}
const blank=name=>Object.fromEntries(idl.types.find(t=>t.name===name).type.fields.map(f=>[f.name,zero(f.type)]));
const encode=(name,row)=>{
  const {layout,discriminator}=PUMP_SDK.offlinePumpProgram.coder.accounts.accountLayouts.get(name);
  const buffer=Buffer.alloc(8192),length=layout.encode(row,buffer);
  const data=Buffer.concat([Buffer.from(discriminator),buffer.subarray(0,length)]);
  return name==='feeConfig'?Buffer.concat([data,Buffer.alloc(Math.max(0,2512-data.length))]):data;
};
async function fixture({base=TOKEN_PROGRAM_ID,agency=false}={}){
  const vault=(agency?deriveAgencyVaultsV3:deriveMintVaultsV3)(programId,sourceMint)[6];
  const curve={...blank('bondingCurve'),virtualTokenReserves:new BN('1073000000000000'),
    virtualQuoteReserves:new BN('30000000000'),realTokenReserves:new BN('793100000000000'),
    tokenTotalSupply:new BN('1000000000000000'),creator:authority};
  const global={...blank('global'),initialized:true,feeRecipient:authority,feeBasisPoints:new BN(100)};
  const fee={...blank('feeConfig'),feeTiers:[{marketCapLamportsThreshold:new BN(0),
    fees:{...blank('fees'),protocolFeeBps:new BN(100)}}]};
  const mintData=Buffer.alloc(82);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,
    supply:1000000000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData);
  const accounts=[{owner:base,data:mintData},{owner:PUMP_PROGRAM_ID,data:await encode('global',global)},
    {owner:PUMP_FEE_PROGRAM_ID,data:await encode('feeConfig',fee)}];
  const account={owner:PUMP_PROGRAM_ID,data:await encode('bondingCurve',curve)};
  const connection={getGenesisHash:async()=>SOLANA_GENESIS.devnet,
    getAccountInfo:async(key,commitment)=>{assert.equal(commitment,'finalized');assert(key.equals(bondingCurvePda(mint)));return account;},
    getMultipleAccountsInfo:async(keys,commitment)=>{assert.equal(commitment,'finalized');assert.equal(keys.length,3);return accounts;}};
  return {connection,mint,vault,budgetLamports:'5000000000',snapshot:{account,curve},base,agency};
}

test('pre-migration buys quote real curve liquidity and bind both fee-policy vaults',async()=>{
  for(const base of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID])for(const agency of [false,true]){
    const f=await fixture({base,agency});
    const snapshot=await readBuybackCurve(f.connection,mint);
    const q=await quoteCurveBuyback({...f,snapshot});
    assert.equal(q.market,'pump-curve');assert.equal(q.maxTotalDebit,'75000000');
    assert(BigInt(q.minBaseAmountOut)>0n);
    assert.equal(q.pumpBuyInstruction.data.readBigUInt64LE(8),BigInt(q.minBaseAmountOut));
    assert.equal(q.pumpBuyInstruction.data.readBigUInt64LE(16),BigInt(q.maxTotalDebit));
    const built=buildV3BuybackInstruction({programId,sourceMint,creator:authority,authority,priceSigner,
      buybackId:Buffer.alloc(32,1),agencyPolicy:agency,...q});
    assert(built.pool.equals(bondingCurvePda(mint)));assert(built.vault.equals(f.vault));
    assert(built.instruction.keys[14].pubkey.equals(PUMP_PROGRAM_ID));
    assert.equal(built.instruction.keys[18+6].isSigner,false);
    assert.deepEqual(v3BuybackFeeSetup({pumpBuyInstruction:q.pumpBuyInstruction,authority}),[]);
  }
});
test('curve route requires explicit activation, and RPC failures never masquerade as migration',async()=>{
  const f=await fixture();
  await assert.rejects(()=>quoteV3Buyback(f),/activation/);
  const q=await quoteV3Buyback({...f,curveEnabled:true});assert.equal(q.market,'pump-curve');
  await assert.rejects(()=>quoteV3Buyback({...f,curveEnabled:true,readCurve:async()=>{throw Error('RPC offline');}}),/RPC offline/);
  f.connection.getAccountInfo=async()=>({owner:SystemProgram.programId,data:Buffer.alloc(128)});
  await assert.rejects(()=>readBuybackCurve(f.connection,mint),/invalid owner/);
});
test('curve purchases reject completed curves, unsupported modes, dust and curve exhaustion',async()=>{
  for(const flag of ['complete','isMayhemMode','isCashbackCoin']){
    const f=await fixture();f.snapshot.curve[flag]=true;
    await assert.rejects(()=>quoteCurveBuyback(f),/unsupported/);
  }
  await assert.rejects(()=>fixture().then(f=>quoteCurveBuyback({...f,budgetLamports:'9999'})),/liquidity/);
  const f=await fixture();
  await assert.rejects(()=>quoteCurveBuyback({...f,quoteOutput:()=>new BN('999999999999999999')}),/exhaust/);
});
test('a substituted mint, curve, destination or signer cannot enter the buyback router',async()=>{
  const f=await fixture(),q=await quoteCurveBuyback(f);
  for(const index of [2,3,4,5,6,8,11,14,15]){
    const buy={...q.pumpBuyInstruction,keys:q.pumpBuyInstruction.keys.map(k=>({...k}))};
    buy.keys[index].pubkey=Keypair.generate().publicKey;
    assert.throws(()=>validateCurveBuy(buy,{mint,vault:f.vault,baseTokenProgram:f.base}),/approved/);
  }
  q.pumpBuyInstruction.keys[1].isSigner=true;
  assert.throws(()=>validateCurveBuy(q.pumpBuyInstruction,{mint,vault:f.vault,baseTokenProgram:f.base}),/approved/);
});

test('curve receipts require finalized purchase, burn, bounded vault debit and matching policy receipt',async()=>{
  const f=await fixture(),q=await quoteCurveBuyback(f);
  const input={...q,programId,sourceMint,creator:authority,authority,priceSigner,buybackId:Buffer.alloc(32,1)};
  const built=buildV3BuybackInstruction(input),signature='mock-finalized-signature';
  const keys=[authority,priceSigner,programId,PUMP_PROGRAM_ID,f.base,...built.instruction.keys.map(k=>k.pubkey)];
  const index=key=>keys.findIndex(k=>k.equals(key));
  const bought=BigInt(q.minBaseAmountOut),spent=BigInt(q.spendableQuoteIn)-1n;
  const buyData=Buffer.alloc(25);q.pumpBuyInstruction.data.copy(buyData);buyData[24]=0;
  const burnData=Buffer.alloc(10);burnData[0]=15;burnData.writeBigUInt64LE(bought,1);burnData[9]=6;
  const receipt=Buffer.alloc(160);createHash('sha256').update('account:MintBuybackV3').digest().copy(receipt,0,0,8);
  input.buybackId.copy(receipt,8);sourceMint.toBuffer().copy(receipt,40);mint.toBuffer().copy(receipt,72);
  built.pool.toBuffer().copy(receipt,104);receipt.writeBigUInt64LE(spent,136);receipt.writeBigUInt64LE(bought,144);receipt.writeBigInt64LE(1700000000n,152);
  const pre=keys.map(()=>1000000000),post=[...pre];post[index(built.vault)]-=Number(spent);
  const tx={slot:100,transaction:{signatures:[signature],message:{accountKeys:keys,header:{numRequiredSignatures:2},instructions:[{
    programIdIndex:index(programId),accounts:built.instruction.keys.map(k=>index(k.pubkey)),data:built.instruction.data}]}},
    meta:{err:null,preBalances:pre,postBalances:post,innerInstructions:[{index:0,instructions:[
      {programIdIndex:index(PUMP_PROGRAM_ID),accounts:q.pumpBuyInstruction.keys.map(k=>index(k.pubkey)),data:buyData},
      {programIdIndex:index(f.base),accounts:[built.fundedAta,mint,built.vault].map(index),data:burnData}]}]}};
  const args={...input,signature,connection:{getTransaction:async()=>tx,getAccountInfo:async()=>({owner:programId,data:receipt})},
    verifyPolicy:async()=>({verified:true,withdrawnLamports:[0n,0n,0n,0n,0n,0n,spent]})};
  const proof=await loadFinalizedV3Buyback(args);assert(proof?.finalized);assert.equal(proof.burnedBaseUnits,String(bought));
  burnData.writeBigUInt64LE(bought-1n,1);assert.equal(await loadFinalizedV3Buyback(args),null);burnData.writeBigUInt64LE(bought,1);
  buyData[24]=1;assert.equal(await loadFinalizedV3Buyback(args),null);buyData[24]=0;
  post[index(built.vault)]=pre[index(built.vault)];assert.equal(await loadFinalizedV3Buyback(args),null);
  post[index(built.vault)]=pre[index(built.vault)]-Number(spent);
  receipt.writeBigUInt64LE(spent+1n,136);assert.equal(await loadFinalizedV3Buyback(args),null);
});
