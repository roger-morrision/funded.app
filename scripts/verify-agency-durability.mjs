import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {createPostgresStore} from '../server/postgres-store.mjs';
import {executeAgencyJournal} from '../server/agency-execution-journal.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {allocationAuditHash} from '../server/allocation-audit-hash.mjs';

// Explicit isolated database only. PostgreSQL is real; RPC, signatures' network
// outcomes and financial proofs below are synthetic and never leave this file.
const url=new URL(process.env.AGENCY_TEST_DATABASE_URL||'invalid:');
assert(['localhost','127.0.0.1'].includes(url.hostname)&&/^\/funded_agency_qa(?:_[a-z0-9]+)?$/.test(url.pathname),
  'Set AGENCY_TEST_DATABASE_URL to an isolated local funded_agency_qa database.');
let store=createPostgresStore(url.href);
const signer=Keypair.fromSeed(Buffer.alloc(32,221)),mint=Keypair.fromSeed(Buffer.alloc(32,222)).publicKey,key=`agency:${mint}:0:0`;
let prepares=0,broadcasts=0,proved=false;
const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getFeeForMessage:async()=>({value:5000}),getBalance:async()=>4000000000,
  isBlockhashValid:async()=>({value:false}),getSignatureStatuses:async()=>({value:[null]}),sendRawTransaction:async raw=>{
    broadcasts++;const saved=(await store.read()).v3AgencyExecutions[key],tx=VersionedTransaction.deserialize(raw);
    assert.equal(saved.signature,bs58.encode(tx.signatures[0]));throw new Error('synthetic accepted-but-response-lost');}};
const args={connection,key,intent:{cluster:'devnet',approvedHash:'a'.repeat(64),postId:'123',amount:'100',nested:{z:'last',a:'first'}},authority:signer,
  prepare:async()=>{
    prepares++;connection.isBlockhashValid=async()=>({value:true});
    return{transaction:new VersionedTransaction(new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:mint.toBase58(),
      instructions:[SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:mint,lamports:100})]}).compileToV0Message()),
      lastValidBlockHeight:1000,estimatedRentLamports:'1000000',evidence:{z:'reordered',a:{z:'last',a:'first'}}};
  },prove:async row=>proved?{signature:row.signature,finalized:true,balanceDeltaVerified:true}:null};
try{
  assert.equal(Object.keys((await store.read()).v3AgencyExecutions).length,0,'Use a fresh isolated QA database.');
  await store.update(state=>{state.v3AgencyPromotions={synthetic:{status:'queued',eventHash:'b'.repeat(64)}};});
  const first=await executeAgencyJournal({...args,store});assert.equal(first.status,'verification-pending');assert.equal(broadcasts,1);
  await store.close();store=createPostgresStore(url.href);connection.isBlockhashValid=async()=>({value:false});
  const restored=(await store.read()).v3AgencyExecutions[key];
  assert.equal(restored.intentHash,allocationAuditHash(args.intent));assert.equal(restored.evidenceHash,allocationAuditHash(restored.evidence));
  assert.equal((await store.read()).v3AgencyPromotions.synthetic.status,'queued');
  const restarted=await executeAgencyJournal({...args,store});assert.equal(restarted.signature,first.signature);assert.equal(prepares,1);assert.equal(broadcasts,1);
  proved=true;assert.equal((await executeAgencyJournal({...args,store})).status,'finalized');
  await store.close();store=createPostgresStore(url.href);const final=(await store.read()).v3AgencyExecutions[key];
  assert.equal(final.status,'finalized');assert.equal(final.signedTransaction,undefined);assert.equal(final.proof.signature,first.signature);
  console.log(JSON.stringify({status:'passed',storage:'real-isolated-postgresql',rpc:'mocked-in-process',checks:8,
    networkTransactionsSubmitted:0,xPostsPublished:0,preservedAcrossRestart:['promotion-intent','signed-transaction','canonical-jsonb-hashes','finalized-proof']}));
}finally{await store.close();}
