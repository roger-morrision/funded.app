import assert from 'node:assert/strict';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {createAutomaticRewardChain} from '../../server/automatic-reward-chain.mjs';
import {rewardExpiryFixture} from './reward-expiry-fixture.mjs';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

export async function expiryExecutionStore(t,f){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-expiry-attempt-'));
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert.ok(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const path=join(dir,'schedule.json'),store=createAutomaticRewardStore(path);
  await store.transaction(state=>{state.schedules[f.plan.id]=structuredClone(f.plan);});
  return {store,path};
}

// Deterministic RPC/signing in memory only. No endpoint, persisted key or funds.
export function expiryExecutionFixture(){
  assert(!process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL&&!process.env.FUNDED_MAINNET_PROGRAM_EVIDENCE_RPC_URL,'Offline expiry fixtures must not configure a network evidence provider.');
  const f=rewardExpiryFixture();f.plan.cluster='devnet';f.submitted=0;f.latestCalls=0;f.autoLand=true;f.proofAvailable=true;f.statusAvailable=true;
  f.rows.get(String(f.router)).data=Buffer.from(f.rows.get(String(f.router)).data.subarray(0,74));
  const read=f.connection.getAccountInfo;
  f.connection.getAccountInfo=async(address,...options)=>f.rows.has(String(address))?f.rows.get(String(address)):read(address,...options);
  f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
  f.connection.getLatestBlockhash=async()=>{f.latestCalls++;return {blockhash:String(new PublicKey(new Uint8Array(32).fill(91))),lastValidBlockHeight:999};};
  f.connection.getBlockHeight=async()=>1000;
  f.land=()=>{
    assert(f.wire);f.advance();f.slot=f.market.slot;f.expire();
    const transaction=Transaction.from(f.wire),message=transaction.compileMessage(),pre=message.accountKeys.map((key,i)=>i===0?100000:f.rows.get(String(key))?.lamports||1000),post=[...pre];post[0]-=5000;
    f.expiryTransaction={slot:f.slot,transaction:{signatures:[f.signature],message},meta:{err:null,fee:5000,preBalances:pre,postBalances:post,innerInstructions:[]}};
  };
  f.connection.sendRawTransaction=async wire=>{
    const transaction=Transaction.from(wire);assert.ok(transaction.verifySignatures());
    assert.equal(String(transaction.signatures[0].publicKey),String(f.operator));
    assert.equal(String(transaction.instructions[0].keys[1].pubkey),String(f.vault));
    await f.beforeSend?.(wire);f.submitted++;f.wire=Buffer.from(wire);f.signature=bs58.encode(transaction.signature);
    if(f.autoLand)f.land();
    if(f.transportFailure)throw Error('network timed out after broadcast');
    return f.signature;
  };
  f.connection.getSignatureStatuses=async()=>({context:{slot:f.slot},value:[f.statusAvailable&&f.expiryTransaction?
    {slot:f.expiryTransaction.slot,err:f.expiryTransaction.meta.err,confirmationStatus:'finalized'}:null]});
  f.connection.getTransaction=async signature=>f.proofAvailable&&signature===f.signature?f.expiryTransaction:null;
  f.chain=()=>createAutomaticRewardChain({connection:f.connection,programId:f.program,authority:Keypair.fromSeed(new Uint8Array(32).fill(33)),
    cluster:'devnet',expectedProgramDataSha256:f.release.programDataSha256});
  return f;
}
