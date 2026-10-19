import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { deriveMintVaultsV3 } from '../mint-router-v3.js';
import { buildV3BuybackInstruction, V3_DEVNET_FUNDED_MINT,
  V3_DEVNET_FUNDED_POOL } from '../server/v3-buyback-instruction.mjs';
import { loadFinalizedV3Buyback } from '../server/v3-buyback-proof.mjs';
import {deriveAgencyVaultsV3,agencyDiscriminator} from '../agency-mint-router-v3.js';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;

function fixture({agency=false,own=false}={}) {
  const programId=key(51), sourceMint=key(52), authority=key(53), creator=key(54);
  const boughtMint=own?sourceMint:V3_DEVNET_FUNDED_MINT,pool=own?key(129):V3_DEVNET_FUNDED_POOL;
  const vault=(agency?deriveAgencyVaultsV3:deriveMintVaultsV3)(programId,sourceMint)[own?7:6];
  const fundedAta=getAssociatedTokenAddressSync(boughtMint,vault,true);
  const quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,vault,true);
  const addresses=Array.from({length:23},(_,index)=>key(index+60));
  addresses.push(key(83),key(84));
  for(const [index,address] of [[0,pool],[1,vault],
    [3,boughtMint],[4,NATIVE_MINT],[5,fundedAta],[6,quoteAta],
    [11,TOKEN_PROGRAM_ID],[12,TOKEN_PROGRAM_ID],[13,SystemProgram.programId],
    [14,ASSOCIATED_TOKEN_PROGRAM_ID],[16,PUMP_AMM_PROGRAM_ID]]) addresses[index]=address;
  const pumpBuyInstruction=new TransactionInstruction({programId:PUMP_AMM_PROGRAM_ID,
    keys:addresses.map((pubkey,index)=>({pubkey,isSigner:index===1,isWritable:index===1})),
    data:Buffer.from([102,6,61,18,1,218,235,234])});
  const params={programId,sourceMint,authority,creator,initialAuthority:authority,
    baseTokenProgram:TOKEN_PROGRAM_ID,buybackId:Buffer.alloc(32,7),
    spendableQuoteIn:'1000000',minBaseAmountOut:'500',maxTotalDebit:'2000000',
    pumpBuyInstruction,...(agency?{agencyPolicy:true}:{}),...(own?{agencyExecution:{agent:1,pool,
      observationSlot:'122',observedAt:1760399999,marketCapUsdMicros:'100000000000',observationHash:Buffer.alloc(32,8)}}:{})};
  const built=buildV3BuybackInstruction(params);
  const tx=new Transaction({feePayer:authority,recentBlockhash:key(110).toBase58()})
    .add(built.instruction);
  const message=tx.compileMessage();
  const keys=message.accountKeys.map(item=>item.toBase58());
  const index=pubkey=>keys.indexOf(pubkey.toBase58());
  const swap=Buffer.alloc(25);
  Buffer.from([198,46,21,82,180,217,232,112]).copy(swap);
  swap.writeBigUInt64LE(1_000_000n,8);swap.writeBigUInt64LE(500n,16);swap[24]=0;
  const burn=Buffer.alloc(10);burn[0]=15;burn.writeBigUInt64LE(750n,1);burn[9]=6;
  const receipt=Buffer.alloc(agency?209:160);
  (agency?agencyDiscriminator('AgencyBuybackV3'):createHash('sha256').update('account:MintBuybackV3').digest().subarray(0,8)).copy(receipt);
  params.buybackId.copy(receipt,8);sourceMint.toBuffer().copy(receipt,40);
  boughtMint.toBuffer().copy(receipt,72);
  pool.toBuffer().copy(receipt,104);
  receipt.writeBigUInt64LE(1_000_000n,136);receipt.writeBigUInt64LE(750n,144);
  receipt.writeBigInt64LE(1_760_400_000n,152);
  if(agency)receipt[160]=own?1:255;
  if(own){receipt.writeBigUInt64LE(122n,161);receipt.writeBigUInt64LE(100000000000n,169);Buffer.alloc(32,8).copy(receipt,177);}
  const preBalances=keys.map(()=>10_000_000),postBalances=[...preBalances];
  postBalances[index(vault)]-=1_000_000;
  const signature=key(111).toBase58();
  const row={slot:123,transaction:{signatures:[signature],message},
    meta:{err:null,preBalances,postBalances,innerInstructions:[{index:0,
      instructions:[{programIdIndex:index(PUMP_AMM_PROGRAM_ID),
        accounts:[index(pool),index(vault)],data:bs58.encode(swap)},
      {programIdIndex:index(TOKEN_PROGRAM_ID),
        accounts:[index(fundedAta),index(boughtMint),index(vault)],
        data:bs58.encode(burn)}]}]}};
  const connection={getTransaction:async()=>row,
    getAccountInfo:async()=>({owner:programId,data:receipt})};
  const verifyPolicy=async()=>({verified:true,withdrawnLamports:[0n,0n,0n,0n,0n,0n,...(own?[0n,1000000n]:[1000000n,0n])],
    ...(agency?{agencyPolicy:true,completedMask:own?2:0,agentSpent:[0n,own?1000000n:0n,0n]}:{})});
  return {params,built,row,receipt,connection,verifyPolicy,signature};
}

test('finalized V3 buyback requires the exact vault debit, swap, burn, and router receipt', async()=>{
  const f=fixture();
  const proof=await loadFinalizedV3Buyback({...f.params,connection:f.connection,
    signature:f.signature,verifyPolicy:f.verifyPolicy});
  assert.equal(f.built.instruction.keys[1].isSigner,false);
  assert.equal(f.row.transaction.message.header.numRequiredSignatures,1);
  assert.equal(proof.spentLamports,'1000000');
  assert.equal(proof.burnedBaseUnits,'750');
  assert.equal(proof.burnedAt,new Date(1_760_400_000_000).toISOString());
  f.receipt.writeBigUInt64LE(751n,144);
  assert.equal(await loadFinalizedV3Buyback({...f.params,connection:f.connection,
    signature:f.signature,verifyPolicy:f.verifyPolicy}),null);
});

test('a V3 buyback without the finalized token burn cannot become a receipt', async()=>{
  const f=fixture();f.row.meta.innerInstructions[0].instructions.pop();
  assert.equal(await loadFinalizedV3Buyback({...f.params,connection:f.connection,
    signature:f.signature,verifyPolicy:f.verifyPolicy}),null);
});

test('agency policy FUNDED buyback retains category six and its pinned target',async()=>{
  const f=fixture({agency:true}),proof=await loadFinalizedV3Buyback({...f.params,connection:f.connection,signature:f.signature,verifyPolicy:f.verifyPolicy});
  assert.equal(f.built.instruction.data.length,122);assert.equal(proof.category,6);assert.equal(proof.agent,255);
  assert.equal(proof.fundedMint,V3_DEVNET_FUNDED_MINT.toBase58());assert.equal(proof.burnedBaseUnits,'750');
});
test('agency own-coin receipt binds the milestone, exact minted asset, spent budget and completed flag',async()=>{
  const f=fixture({agency:true,own:true}),input={...f.params,connection:f.connection,signature:f.signature,verifyPolicy:f.verifyPolicy};
  const proof=await loadFinalizedV3Buyback(input);assert.equal(proof.category,7);assert.equal(proof.agent,1);
  assert.equal(proof.fundedMint,f.params.sourceMint.toBase58());assert.equal(proof.spentLamports,'1000000');
  assert.equal(f.built.instruction.data[40],7);assert.equal(f.built.instruction.data[41],1);
  assert.equal(f.built.instruction.data.readBigUInt64LE(42),122n);assert.equal(f.built.instruction.data.readBigUInt64LE(58),100000000000n);
  f.receipt[177]^=1;assert.equal(await loadFinalizedV3Buyback(input),null);f.receipt[177]^=1;
  assert.equal(await loadFinalizedV3Buyback({...input,verifyPolicy:async()=>({...await f.verifyPolicy(),completedMask:0})}),null);
  f.row.meta.innerInstructions[0].instructions.pop();assert.equal(await loadFinalizedV3Buyback(input),null);
  assert.throws(()=>buildV3BuybackInstruction({...f.params,agencyExecution:{...f.params.agencyExecution,marketCapUsdMicros:'99999999999'}}),/milestone/);
});
