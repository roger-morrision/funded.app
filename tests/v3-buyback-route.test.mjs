import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { deriveMintVaultsV3 } from '../mint-router-v3.js';
import { v3AllocationPlan } from '../server/v3-allocation-plan.mjs';
import { V3_DEVNET_FUNDED_MINT, V3_DEVNET_FUNDED_POOL } from '../server/v3-buyback-instruction.mjs';
import { createV3BuybackRoutes } from '../server/routes/v3-buyback.mjs';

const key=byte=>Keypair.fromSeed(new Uint8Array(32).fill(byte));
const creator=key(41),authority=key(42),program=key(43),mint=key(44);
const signature='3'.repeat(64),settlementSignature='4'.repeat(64);
const programId=program.publicKey.toBase58(), mintAddress=mint.publicKey.toBase58();

function fixture(enabled=true, triggerReached=true) {
  let currentTrigger=triggerReached;
  let proofAvailable=true,signatureOutcome=null,balance=4000000000,fee=5000,submitted=0;
  const vault=deriveMintVaultsV3(programId,mintAddress)[6];
  const baseAta=getAssociatedTokenAddressSync(V3_DEVNET_FUNDED_MINT,vault,true);
  const quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,vault,true);
  const addresses=Array.from({length:25},(_,i)=>key(i+60).publicKey);
  for(const [ownerIndex,ataIndex] of [[9,10],[18,17],[23,24]])
    addresses[ataIndex]=getAssociatedTokenAddressSync(NATIVE_MINT,addresses[ownerIndex],true);
  for(const [index,value] of [[0,V3_DEVNET_FUNDED_POOL],[1,vault],
    [3,V3_DEVNET_FUNDED_MINT],[4,NATIVE_MINT],[5,baseAta],[6,quoteAta],
    [11,TOKEN_PROGRAM_ID],[12,TOKEN_PROGRAM_ID],[13,SystemProgram.programId],
    [14,ASSOCIATED_TOKEN_PROGRAM_ID],[16,PUMP_AMM_PROGRAM_ID]])addresses[index]=value;
  const pumpBuyInstruction=new TransactionInstruction({programId:PUMP_AMM_PROGRAM_ID,
    keys:addresses.map((pubkey,index)=>({pubkey,isSigner:index===1,isWritable:index===1})),
    data:Buffer.from([102,6,61,18,1,218,235,234])});
  const launch={mint:mintAddress,onchainVerified:true,cluster:'devnet',
    creatorWallet:creator.publicKey.toBase58(),xUserId:'12345',
    pumpFeeRoute:{scope:'per-mint-v3',programId,
      initialAuthority:authority.publicKey.toBase58()},
    feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:60,
      holderAirdropPercent:15,solClaimPercent:5},recipients:{xAccount:'@qa'}}}};
  const settlement={signature:settlementSignature,mint:mintAddress,
    claimId:Buffer.alloc(32,9).toString('hex'),expectedLamports:'100',
    categoryLamports:['80','10','2','1','0','2','5']};
  const plan=v3AllocationPlan({launch,settlement:{...settlement,programId,
    collectionSignature:signature,settlementSignature}});
  const state={launches:{[mintAddress]:launch},
    collections:{[signature]:{signature,mint:mintAddress,scope:'per-mint-v3',
      status:'collected',onchainVerified:true,programId,claimId:settlement.claimId,
      collectedLamports:100,router:'router-fixture'}},
    v3Settlements:{[signature]:{status:'finalized',mint:mintAddress,
      collectionSignature:signature,settlementSignature,allocationPlan:plan}},
    v3BuybackOrders:{}};
  const responses=[];
  const lookupAddress=key(120).publicKey;
  const connection={getAddressLookupTable:async()=>({value:{key:lookupAddress,
    state:{addresses:addresses.filter(address=>!address.equals(vault))}}}),
    getLatestBlockhash:async()=>({blockhash:key(121).publicKey.toBase58()}),
    getSignatureStatuses:async()=>({value:[signatureOutcome]}),getBalance:async()=>balance,
    getFeeForMessage:async()=>({value:fee}),getMinimumBalanceForRentExemption:async()=>1000000};
  const route=createV3BuybackRoutes({body:async req=>req.input,
    store:{read:async()=>state,update:async callback=>callback(state)},
    solanaCluster:'devnet',solanaRpcUrl:'https://unused.invalid',
    v3AuthorityKeypair:()=>authority,respond:(_res,status,data)=>responses.push({status,data}),
    env:{FUNDED_V3_BUYBACK_ENABLED:enabled?'true':'false',
      FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),
      FUNDED_V3_BUYBACK_LOOKUP_TABLE:lookupAddress.toBase58()},
    originAllowed:()=>true,connectionFactory:()=>connection,
    verifyReadiness:async()=>({ready:true,configuredRouter:'router-fixture'}),
    loadSettlement:async()=>settlement,
    quote:async({budgetLamports})=>({pumpBuyInstruction,baseTokenProgram:TOKEN_PROGRAM_ID,
      spendableQuoteIn:String(BigInt(budgetLamports)<3n?budgetLamports:'3'),
      minBaseAmountOut:'1',maxTotalDebit:String(budgetLamports)}),
    loadProof:async input=>proofAvailable?({signature:input.signature,status:'finalized',
      spentLamports:input.spendableQuoteIn,burnedBaseUnits:'1',finalized:true,
      vaultDebitVerified:true,burnInstructionVerified:true}):null,
    readDashboard:async()=>({status:'verified',triggerReached:currentTrigger}),
    submit:async({transaction})=>{submitted++;return bs58.encode(transaction.signatures[0]);}});
  return {state,responses,setTrigger:value=>{currentTrigger=value;},
    setBalance:value=>{balance=value;},setFee:value=>{fee=value;},get submitted(){return submitted;},
    setProof:value=>{proofAvailable=value;},setSignatureOutcome:value=>{signatureOutcome=value;},
    request:(input,source=signature)=>route({method:'POST',input,headers:{}},{},
      new URL(`/api/tokens/${mintAddress}/v3-buyback/${source}`,'https://funded.vip'))};
}

test('V3 buyback cannot prepare while the Devnet pilot gate is off',async()=>{
  const f=fixture(false);await f.request({});
  assert.equal(f.responses.at(-1).status,503);
  assert.deepEqual(f.state.v3BuybackOrders,{});
});

test('generic buyback never signs below reserve plus all setup rent and fees, or with an unknown fee',async()=>{
  for(const balance of [3000000000,3007004999]){
    const f=fixture();f.setBalance(balance);await f.request({});assert.equal(f.responses.at(-1).status,409);
    assert.equal(f.submitted,0);assert(Object.values(f.state.v3BuybackOrders).every(row=>!row.signature&&!row.signedTransaction));
  }
  const unknown=fixture();unknown.setFee(null);await unknown.request({});assert.equal(unknown.responses.at(-1).status,503);assert.equal(unknown.submitted,0);
  const boundary=fixture();boundary.setBalance(3007005000);await boundary.request({});assert.equal(boundary.responses.at(-1).status,200);assert.equal(boundary.submitted,1);
});

test('V3 buyback executes without creator signature only after the 5 SOL vault trigger',async()=>{
  const below=fixture(true,false);await below.request({});
  assert.equal(below.responses.at(-1).status,409);
  assert.deepEqual(below.state.v3BuybackOrders,{});
  const f=fixture();await f.request({});
  assert.equal(f.responses.at(-1).status,200);
  assert.equal(f.state.v3BuybackOrders[signature].status,'finalized');
  assert.equal(f.state.v3BuybackOrders[signature].cycleId.startsWith('v3-buyback:'),true);
  f.setTrigger(false);
  await f.request({});
  assert.equal(f.responses.at(-1).status,409,'A finished round cannot reuse its old cycle below 5 SOL.');
  assert.equal(Object.keys(f.state.v3BuybackOrders).length,1);
  f.setTrigger(true);
  await f.request({});
  assert.equal(f.responses.at(-1).status,200);
  assert.equal(f.state.v3BuybackOrders[`${signature}:2`].status,'finalized');
  assert.notEqual(f.state.v3BuybackOrders[signature].buybackId,
    f.state.v3BuybackOrders[`${signature}:2`].buybackId);
  await f.request({});
  assert.equal(f.responses.at(-1).status,409);
  assert.equal(Object.keys(f.state.v3BuybackOrders).length,2);
});

test('a triggered cycle finishes queued collections after the total drops below 5 SOL',async()=>{
  const f=fixture();
  const second='5'.repeat(64);
  f.state.collections[second]={...f.state.collections[signature],signature:second};
  f.state.v3Settlements[second]={...f.state.v3Settlements[signature],
    collectionSignature:second,
    allocationPlan:v3AllocationPlan({launch:f.state.launches[mintAddress],
      settlement:{signature:settlementSignature,mint:mintAddress,
        collectionSignature:second,settlementSignature,programId,
        expectedLamports:'100',claimId:Buffer.alloc(32,9).toString('hex'),
        categoryLamports:['80','10','2','1','0','2','5']}})};
  await f.request({});
  assert.equal(f.state.v3BuybackOrders[second].status,'queued');
  f.setTrigger(false);
  await f.request({},second);
  assert.equal(f.responses.at(-1).status,200);
  assert.equal(f.state.v3BuybackOrders[second].status,'finalized');
  await f.request({});
  assert.equal(f.responses.at(-1).status,409,'Finalized residue must wait for another trigger.');
  f.setTrigger(true);
  await f.request({});
  assert.equal(f.responses.at(-1).status,200);
  assert.equal(f.state.v3BuybackOrders[`${second}:2`].status,'queued',
    'A new 5 SOL cycle must include other verified residual allocations.');
});

test('a finalized failed swap keeps its signature audit trail and requeues safely',async()=>{
  const f=fixture();await f.request({});
  const row=f.state.v3BuybackOrders[signature];
  row.status='verification-pending';row.finalized=false;
  f.setProof(false);
  f.setSignatureOutcome({confirmationStatus:'finalized',err:{InstructionError:[1,1]}});
  await f.request({});
  assert.equal(f.responses.at(-1).status,409);
  assert.equal(row.signature,f.state.v3BuybackOrders[signature].failedSignatures[0]);
  assert.equal(f.state.v3BuybackOrders[signature].status,'queued');
  assert.equal(f.state.v3BuybackOrders[signature].signature,undefined);
});
