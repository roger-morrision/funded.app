import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { captureExactCommunitySnapshot, reverseReplayCommunitySnapshot } from '../server/community-snapshot.mjs';

function fixture() {
  const mint=Keypair.generate().publicKey,launchMint=Keypair.generate().publicKey,
    wallet=Keypair.generate().publicKey,account=Keypair.generate().publicKey,pool=canonicalPumpPoolPda(launchMint,NATIVE_MINT);
  const mintBytes=Buffer.alloc(82);mintBytes.writeBigUInt64LE(100n,36);
  const tokenBytes=Buffer.alloc(165);mint.toBuffer().copy(tokenBytes);wallet.toBuffer().copy(tokenBytes,32);
  tokenBytes.writeBigUInt64LE(100n,64);tokenBytes[108]=1;
  const transaction={slot:100,blockTime:1_800_000_000,meta:{err:null},transaction:{message:{
    accountKeys:[PUMP_PROGRAM_ID,launchMint,pool],instructions:[{programIdIndex:0,accounts:[1,2],
      data:bs58.encode(createHash('sha256').update('global:migrate_v2').digest().subarray(0,8))}]}}};
  const connection={getTransaction:async()=>transaction,getAccountInfo:async()=>({owner:PUMP_AMM_PROGRAM_ID}),
    getSlot:async()=>101,getTokenLargestAccounts:async()=>({context:{slot:101},value:[{address:account}]}),
    getMultipleAccountsInfoAndContext:async()=>({context:{slot:101},value:[
      {owner:TOKEN_PROGRAM_ID,data:mintBytes},{owner:TOKEN_PROGRAM_ID,data:tokenBytes}]}),
    getBlocks:async()=>[101],getParsedBlock:async()=>({blockhash:'archived-block',transactions:[]})};
  return {connection,mint,launchMint,migrationSignature:'3'.repeat(64)};
}

test('a genuine snapshot can be reconstructed from its retained evidence after JSON storage',async()=>{
  let evidence;const snapshot=await captureExactCommunitySnapshot({...fixture(),onEvidence:value=>{evidence=value;}});
  const archive=JSON.parse(JSON.stringify(evidence,(_key,value)=>typeof value==='bigint'?String(value):value));
  const replay=reverseReplayCommunitySnapshot({...archive,blocks:new Map(archive.blocks)});
  assert.deepEqual(replay,snapshot);assert.equal(archive.baseSlot,101);
  assert.equal(archive.migrationTransaction.slot,100);assert.equal(archive.blocks[0][1].blockhash,'archived-block');
  archive.baseAccounts[0].balance='99';
  assert.throws(()=>reverseReplayCommunitySnapshot({...archive,blocks:new Map(archive.blocks)}),/full eligibility supply/);
});

test('missing replay blocks fail before any verified evidence is emitted',async()=>{
  let archived=false;const input=fixture();input.connection.getParsedBlock=async()=>null;
  await assert.rejects(captureExactCommunitySnapshot({...input,onEvidence:()=>{archived=true;}}),/unavailable/);
  assert.equal(archived,false);
});
