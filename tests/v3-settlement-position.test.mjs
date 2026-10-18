import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { buildMintRouterV3SettlementInstruction, protocolGrossUnits } from '../mint-router-v3.js';
import { loadV3SettlementPosition } from '../server/v3-settlement-position.mjs';
const keys=Array.from({length:4},(_,i)=>Keypair.fromSeed(Buffer.alloc(32,i+10)).publicKey);
const sig=i=>bs58.encode(Buffer.alloc(64,i));
function categories(total){let prefix=0n,prior=0n;return [8000000,...protocolGrossUnits()].map(value=>{
  prefix+=BigInt(value);const end=total*prefix/10000000n,delta=end-prior;prior=end;return delta;
});}
function fixture(){
  const [programId,mint,authority,creator]=keys, amount=1000002n, total=4n*amount;
  const txs=new Map();
  for(let i=1;i<=4;i++){
    const built=buildMintRouterV3SettlementInstruction({programId,mint,authority,creator,claimId:Buffer.alloc(32,i),expectedLamports:amount});
    const message=new Transaction({feePayer:authority,recentBlockhash:mint.toBase58()}).add(built.instruction).compileMessage();
    txs.set(sig(i),{slot:i===4?101:100,meta:{err:null},transaction:{signatures:[sig(i)],message}});
  }
  const refs=[4,1,3,2].map(i=>({signature:sig(i),slot:i===4?101:100,err:null,confirmationStatus:'finalized'}));
  const low=categories(amount),high=categories(2n*amount);
  const connection={getAccountInfoAndContext:async()=>({context:{slot:102},value:{data:Buffer.alloc(0)}}),
    getBlockSignatures:async()=>({signatures:[sig(1),sig(2),sig(3)]}),getSignaturesForAddress:async()=>refs,
    getTransaction:async signature=>txs.get(signature)};
  const input={connection,signature:sig(2),slot:100,programId,mint,authority,creator,expectedLamports:amount,
    categoryLamports:high.map((value,i)=>value-low[i]),verifyPolicy:async()=>({verified:true,settledLamports:total})};
  return {input,connection,txs,refs};
}
test('cumulative settlement position uses finalized block order for same-slot claims',async()=>{
 const f=fixture();const proof=await loadV3SettlementPosition(f.input);
 assert.deepEqual(proof,{settledBeforeLamports:'1000002',settledAfterLamports:'2000004',creatorPoolBeforeLamports:'800001',creatorPoolAfterLamports:'1600003',policySettledLamports:'4000008'});
});
test('missing later transactions, unknown policy mutations and category mismatch fail closed',async()=>{
 const f=fixture();f.txs.delete(sig(4));await assert.rejects(loadV3SettlementPosition(f.input),/history is unavailable/);
 const g=fixture();g.txs.get(sig(4)).transaction.message.instructions[0].data=bs58.encode(Buffer.alloc(48,7));
 await assert.rejects(loadV3SettlementPosition(g.input),/Unknown V3 policy mutation/);
 const h=fixture();h.input.categoryLamports[0]++;await assert.rejects(loadV3SettlementPosition(h.input),/category deltas/);
});
test('pruned history, duplicate references and missing finalized block order are rejected',async()=>{
 const f=fixture();f.refs.pop();await assert.rejects(loadV3SettlementPosition(f.input),/missing from finalized/);
 const g=fixture();g.refs.splice(1,0,g.refs[0]);await assert.rejects(loadV3SettlementPosition(g.input),/ordering or finality/);
 const h=fixture();h.connection.getBlockSignatures=async()=>null;await assert.rejects(loadV3SettlementPosition(h.input),/block order/);
});

test('finalized signature ordering works through the installed Solana SDK response decoder',async()=>{
 const f=fixture();
 const rpc=new Connection('http://127.0.0.1:8899',{fetch:async(_url,options)=>{
  const request=JSON.parse(options.body);
  assert.equal(request.method,'getBlock');
  assert.equal(request.params[1].transactionDetails,'signatures');
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{
   blockhash:keys[1].toBase58(),previousBlockhash:keys[1].toBase58(),parentSlot:99,
   blockTime:1000,blockHeight:100,signatures:[sig(1),sig(2),sig(3)],
  }}));
 }});
 f.connection.getBlock=rpc.getBlock.bind(rpc);
 f.connection.getBlockSignatures=rpc.getBlockSignatures.bind(rpc);
 const proof=await loadV3SettlementPosition(f.input);
 assert.equal(proof.settledBeforeLamports,'1000002');
});
