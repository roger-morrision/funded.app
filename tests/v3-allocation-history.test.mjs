import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,Transaction} from '@solana/web3.js';
import {buildMintRouterV3SettlementInstruction,protocolGrossUnits} from '../mint-router-v3.js';
import {v3AllocationPlan} from '../server/v3-allocation-plan.mjs';
import {loadFinalizedV3Settlement} from '../server/v3-settlement-proof.mjs';
import {reconcileV3Allocations} from '../server/v3-allocation-reconciliation.mjs';

const [programId,mint,authority,creator]=[41,42,43,44].map(byte=>Keypair.fromSeed(Buffer.alloc(32,byte)).publicKey);
const sig=i=>bs58.encode(Buffer.alloc(64,i));
const discriminator=name=>createHash('sha256').update(`account:${name}`).digest().subarray(0,8);
const categories=total=>{
 let prefix=0n,prior=0n;
 return [8_000_000,...protocolGrossUnits()].map(units=>{prefix+=BigInt(units);const end=total*prefix/10_000_000n;const delta=end-prior;prior=end;return delta;});
};

// Complete deterministic RPC responses exercise the production transaction,
// claim, policy, cumulative-position and allocation verifiers. No chain writes.
function fixture(count){
 const amount=1_000_002n,total=BigInt(count)*amount,accounts=new Map(),transactions=new Map(),calls={};
 const launch={mint:mint.toBase58(),onchainVerified:true,cluster:'devnet',creatorWallet:creator.toBase58(),
  pumpFeeRoute:{scope:'per-mint-v3',programId:programId.toBase58(),initialAuthority:authority.toBase58()},
  feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:70,holderAirdropPercent:10,solClaimPercent:0},recipients:{xAccount:''}}}};
 const state={launches:{[launch.mint]:launch},collections:{},v3Settlements:{}},refs=[];
 let policyAddress;
 for(let i=1;i<=count;i++){
  const claimId=Buffer.alloc(32,i),source=`source-${i}`,signature=sig(i);
  const built=buildMintRouterV3SettlementInstruction({programId,mint,authority,creator,claimId,expectedLamports:amount});
  const low=categories(BigInt(i-1)*amount),high=categories(BigInt(i)*amount),deltas=high.map((value,index)=>value-low[index]);
  const message=new Transaction({feePayer:authority,recentBlockhash:mint.toBase58()}).add(built.instruction).compileMessage();
  const before=message.accountKeys.map(()=>0),after=[...before],router=message.accountKeys.findIndex(key=>key.equals(built.router.address));
  before[router]=Number(amount);
  transactions.set(signature,{slot:100+i,meta:{err:null,preBalances:before,postBalances:after},transaction:{signatures:[signature],message}});
  refs.unshift({signature,slot:100+i,err:null,confirmationStatus:'finalized'});
  const claim=Buffer.alloc(144);discriminator('MintClaimRecordV3').copy(claim);claimId.copy(claim,8);mint.toBuffer().copy(claim,40);claim.writeBigUInt64LE(amount,72);
  deltas.forEach((value,index)=>claim.writeBigUInt64LE(value,80+index*8));
  accounts.set(built.claim.toBase58(),{owner:programId,data:claim});
  if(!policyAddress){
   policyAddress=built.policy.address;
   const policy=Buffer.alloc(249);discriminator('MintFeePolicyV3').copy(policy);mint.toBuffer().copy(policy,8);creator.toBuffer().copy(policy,40);authority.toBuffer().copy(policy,72);
   protocolGrossUnits().forEach((units,index)=>policy.writeUInt32LE(units,104+index*4));policy.writeBigUInt64LE(total,128);
   categories(total).forEach((value,index)=>policy.writeBigUInt64LE(value,136+index*8));policy[248]=built.policy.bump;
   accounts.set(policyAddress.toBase58(),{owner:programId,data:policy});
  }
  const proof={signature,mint:launch.mint,programId:programId.toBase58(),collectionSignature:source,settlementSignature:signature,
   expectedLamports:String(amount),categoryLamports:deltas.map(String),
   position:{settledBeforeLamports:String(BigInt(i-1)*amount),settledAfterLamports:String(BigInt(i)*amount),policySettledLamports:String(total),creatorPoolBeforeLamports:String(low[0]),creatorPoolAfterLamports:String(high[0])}};
  state.collections[source]={signature:source,mint:launch.mint,status:'collected',onchainVerified:true,cluster:'devnet',scope:'per-mint-v3',programId:programId.toBase58(),claimId:claimId.toString('hex'),collectedLamports:String(amount)};
  state.v3Settlements[source]={mint:launch.mint,collectionSignature:source,settlementSignature:signature,status:'finalized',allocationPlan:v3AllocationPlan({launch,settlement:proof})};
 }
 const read=(name,fn)=>async(...args)=>{calls[name]=(calls[name]||0)+1;return fn(...args);};
 const connection={getTransaction:read('transaction',signature=>transactions.get(signature)||null),
  getAccountInfo:read('account',key=>accounts.get(key.toBase58())||null),
  getAccountInfoAndContext:read('snapshot',()=>({context:{slot:101+count},value:accounts.get(policyAddress.toBase58())})),
  getBlockSignatures:read('block',slot=>({signatures:[sig(slot-100)]})),getSignaturesForAddress:read('history',()=>refs)};
 const store={read:async()=>structuredClone(state),update:async()=>{throw new Error('Canonical allocations must stay unchanged.');}};
 const args={store,connection,mint:launch.mint};
 return {state,accounts,transactions,refs,calls,args,totalCalls:()=>Object.values(calls).reduce((sum,value)=>sum+value,0)};
}

test('FQA-005 uncached twelve-source baseline retains all proof checks and 102 position reads',async t=>{
 const f=fixture(12);
 for(const pass of ['first','repeated']){
  for(const key of Object.keys(f.calls))delete f.calls[key];
  await reconcileV3Allocations({...f.args,loadSettlement:args=>loadFinalizedV3Settlement({...args,connection:f.args.connection})});
  assert.deepEqual(f.calls,{transaction:78,account:24,snapshot:12,block:12,history:12});
  assert.equal(f.totalCalls(),138); // 102 cumulative-position reads plus36 primary proof reads.
  t.diagnostic(JSON.stringify({mode:'uncached',count:12,pass,calls:f.calls,total:f.totalCalls()}));
 }
});

for(const count of [1,12,36,64])test(`FQA-005 ${count} canonical sources keep exact allocations with linear RPC reads`,async t=>{
 const f=fixture(count),before=structuredClone(f.state);
 for(const pass of ['first','repeated']){
  for(const key of Object.keys(f.calls))delete f.calls[key];
  const result=await reconcileV3Allocations(f.args);
  assert.deepEqual(result,before);assert.deepEqual(f.state,before);
  assert.ok(f.totalCalls()<=3*count+3,`${f.totalCalls()} RPC reads exceed ${3*count+3}`);
  assert.equal(f.calls.transaction,count);
  t.diagnostic(JSON.stringify({mode:'request-cache',count,pass,calls:f.calls,total:f.totalCalls()}));
 }
});

test('FQA-005 a later request rechecks missing and changed historical proof',async()=>{
 const f=fixture(3),before=structuredClone(f.state);
 await reconcileV3Allocations(f.args);
 f.transactions.delete(sig(3));
 await assert.rejects(reconcileV3Allocations(f.args),/settlement evidence is unavailable/);
 assert.deepEqual(f.state,before);
 const g=fixture(3);await reconcileV3Allocations(g.args);
 g.transactions.get(sig(3)).transaction.message.instructions[0].data=bs58.encode(Buffer.alloc(48,7));
 await assert.rejects(reconcileV3Allocations(g.args),/settlement evidence is unavailable/);
 assert.deepEqual(g.state,before);
});

for(const failure of ['non-finalized','misordered','missing-block','changed-claim','failed-transaction'])test(`FQA-005 new request rejects ${failure} evidence after a successful pass`,async()=>{
 const f=fixture(3),before=structuredClone(f.state);
 await reconcileV3Allocations(f.args);
 if(failure==='non-finalized')f.refs[0].confirmationStatus='confirmed';
 if(failure==='misordered')f.refs.reverse();
 if(failure==='missing-block')f.args.connection.getBlockSignatures=async()=>null;
 if(failure==='failed-transaction')f.transactions.get(sig(3)).meta.err={InstructionError:[0,'fixture-failure']};
 if(failure==='changed-claim'){
  const claim=[...f.accounts.values()].find(account=>account.data.length===144);
  claim.data.writeBigUInt64LE(1n,72);
 }
 await assert.rejects(reconcileV3Allocations(f.args),/settlement evidence is unavailable/);
 assert.deepEqual(f.state,before);
});

test('FQA-005 a missing source or changed program identity on a later request cannot reuse prior proof',async()=>{
 for(const failure of ['missing-source','changed-program']){
  const f=fixture(3);await reconcileV3Allocations(f.args);
  if(failure==='missing-source')delete f.state.v3Settlements['source-1'];
  else f.state.launches[mint.toBase58()].pumpFeeRoute.programId=creator.toBase58();
  const before=structuredClone(f.state);
  await assert.rejects(reconcileV3Allocations(f.args),/source history is incomplete|every matching finalized source/);
  assert.deepEqual(f.state,before);
 }
});
