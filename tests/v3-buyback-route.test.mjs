import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, SystemProgram, TransactionInstruction,
  VersionedTransaction } from '@solana/web3.js';
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

function fixture(enabled=true) {
  const vault=deriveMintVaultsV3(programId,mintAddress)[6];
  const baseAta=getAssociatedTokenAddressSync(V3_DEVNET_FUNDED_MINT,vault,true);
  const quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,vault,true);
  const addresses=Array.from({length:25},(_,i)=>key(i+60).publicKey);
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
    getLatestBlockhash:async()=>({blockhash:key(121).publicKey.toBase58()})};
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
    quote:async()=>({pumpBuyInstruction,baseTokenProgram:TOKEN_PROGRAM_ID,
      spendableQuoteIn:'3',minBaseAmountOut:'1',
      maxTotalDebit:plan.protocol.buybackLamports}),
    loadProof:async input=>({signature:input.signature,status:'finalized',
      spentLamports:'3',burnedBaseUnits:'1',finalized:true,
      vaultDebitVerified:true,burnInstructionVerified:true}),
    submit:async({transaction})=>bs58.encode(transaction.signatures[0])});
  return {state,responses,request:input=>route({method:'POST',input,headers:{}},{},
    new URL(`/api/tokens/${mintAddress}/v3-buyback/${signature}`,'https://funded.vip'))};
}

test('V3 buyback cannot prepare while the Devnet pilot gate is off',async()=>{
  const f=fixture(false);await f.request({});
  assert.equal(f.responses.at(-1).status,503);
  assert.deepEqual(f.state.v3BuybackOrders,{});
});

test('V3 buyback keeps one creator-signed quote and requires finalized burn proof',async()=>{
  const f=fixture();await f.request({});
  assert.equal(f.responses.at(-1).status,202);
  const unsigned=f.responses.at(-1).data.transaction;
  const tx=VersionedTransaction.deserialize(Buffer.from(unsigned,'base64'));
  tx.sign([creator]);
  await f.request({creatorSignedTransaction:Buffer.from(tx.serialize()).toString('base64')});
  assert.equal(f.responses.at(-1).status,200);
  assert.equal(f.state.v3BuybackOrders[signature].status,'finalized');
  await f.request({});
  assert.equal(f.responses.at(-1).status,200);
});
