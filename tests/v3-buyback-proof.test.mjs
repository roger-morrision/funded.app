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

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;

function fixture() {
  const programId=key(51), sourceMint=key(52), authority=key(53), creator=key(54);
  const vault=deriveMintVaultsV3(programId,sourceMint)[6];
  const fundedAta=getAssociatedTokenAddressSync(V3_DEVNET_FUNDED_MINT,vault,true);
  const quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,vault,true);
  const addresses=Array.from({length:23},(_,index)=>key(index+60));
  addresses.push(key(83),key(84));
  for(const [index,address] of [[0,V3_DEVNET_FUNDED_POOL],[1,vault],
    [3,V3_DEVNET_FUNDED_MINT],[4,NATIVE_MINT],[5,fundedAta],[6,quoteAta],
    [11,TOKEN_PROGRAM_ID],[12,TOKEN_PROGRAM_ID],[13,SystemProgram.programId],
    [14,ASSOCIATED_TOKEN_PROGRAM_ID],[16,PUMP_AMM_PROGRAM_ID]]) addresses[index]=address;
  const pumpBuyInstruction=new TransactionInstruction({programId:PUMP_AMM_PROGRAM_ID,
    keys:addresses.map((pubkey,index)=>({pubkey,isSigner:index===1,isWritable:index===1})),
    data:Buffer.from([102,6,61,18,1,218,235,234])});
  const params={programId,sourceMint,authority,creator,initialAuthority:authority,
    baseTokenProgram:TOKEN_PROGRAM_ID,buybackId:Buffer.alloc(32,7),
    spendableQuoteIn:'1000000',minBaseAmountOut:'500',maxTotalDebit:'2000000',
    pumpBuyInstruction};
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
  const receipt=Buffer.alloc(160);
  createHash('sha256').update('account:MintBuybackV3').digest().subarray(0,8).copy(receipt);
  params.buybackId.copy(receipt,8);sourceMint.toBuffer().copy(receipt,40);
  V3_DEVNET_FUNDED_MINT.toBuffer().copy(receipt,72);
  V3_DEVNET_FUNDED_POOL.toBuffer().copy(receipt,104);
  receipt.writeBigUInt64LE(1_000_000n,136);receipt.writeBigUInt64LE(750n,144);
  const preBalances=keys.map(()=>10_000_000),postBalances=[...preBalances];
  postBalances[index(vault)]-=1_000_000;
  const signature=key(111).toBase58();
  const row={slot:123,transaction:{signatures:[signature],message},
    meta:{err:null,preBalances,postBalances,innerInstructions:[{index:0,
      instructions:[{programIdIndex:index(PUMP_AMM_PROGRAM_ID),
        accounts:[index(V3_DEVNET_FUNDED_POOL),index(vault)],data:bs58.encode(swap)},
      {programIdIndex:index(TOKEN_PROGRAM_ID),
        accounts:[index(fundedAta),index(V3_DEVNET_FUNDED_MINT),index(vault)],
        data:bs58.encode(burn)}]}]}};
  const connection={getTransaction:async()=>row,
    getAccountInfo:async()=>({owner:programId,data:receipt})};
  const verifyPolicy=async()=>({verified:true,withdrawnLamports:[0n,0n,0n,0n,0n,0n,1_000_000n]});
  return {params,built,row,receipt,connection,verifyPolicy,signature};
}

test('finalized V3 buyback requires the exact vault debit, swap, burn, and router receipt', async()=>{
  const f=fixture();
  const proof=await loadFinalizedV3Buyback({...f.params,connection:f.connection,
    signature:f.signature,verifyPolicy:f.verifyPolicy});
  assert.equal(proof.spentLamports,'1000000');
  assert.equal(proof.burnedBaseUnits,'750');
  f.receipt.writeBigUInt64LE(751n,144);
  assert.equal(await loadFinalizedV3Buyback({...f.params,connection:f.connection,
    signature:f.signature,verifyPolicy:f.verifyPolicy}),null);
});

test('a V3 buyback without the finalized token burn cannot become a receipt', async()=>{
  const f=fixture();f.row.meta.innerInstructions[0].instructions.pop();
  assert.equal(await loadFinalizedV3Buyback({...f.params,connection:f.connection,
    signature:f.signature,verifyPolicy:f.verifyPolicy}),null);
});
