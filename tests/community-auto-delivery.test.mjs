import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,PublicKey,TransactionMessage} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {buildCommunityManifest} from '../community-merkle.js';
import {communityAddresses,buildCommunityClaimInstruction} from '../server/community-claim-chain.mjs';
import {verifyCommunityDelivery} from '../server/community-delivery-proof.mjs';
import {createCommunityAutoDelivery} from '../server/community-auto-delivery.mjs';
const pair=n=>Keypair.fromSeed(Buffer.alloc(32,n)),authority=pair(81),holder=pair(82).publicKey.toBase58(),other=pair(83).publicKey.toBase58();
const programId=pair(84).publicKey.toBase58(),mint=pair(85).publicKey.toBase58(),eligibilityMint=pair(86).publicKey.toBase58();
const drop=communityAddresses({programId,authority:authority.publicKey,mint}).drop.toBase58();
const snapshot={mint:eligibilityMint,finalized:true,coverage:'finalized-exact-slot-v1',slot:123,blockTime:1800000000,
  supplyBaseUnits:'100',accounts:[{wallet:holder,balance:'75'},{wallet:other,balance:'25'}]};
const manifest=buildCommunityManifest({drop,launchMint:mint,eligibilityMint,migrationSignature:bs58.encode(Buffer.alloc(64,9)),migrationSlot:123,migrationBlockTime:1800000000,snapshot,amountBaseUnits:'1000'});
const record={mint,programId,authority:authority.publicKey.toBase58(),snapshotBasis:'pump-migration',tokenProgram:TOKEN_PROGRAM_ID.toBase58(),manifest};
const leaf=manifest.leaves.find(x=>x.recipient===holder);
function proofFixture(){
  const built=buildCommunityClaimInstruction({programId,authority:authority.publicKey,mint,tokenProgram:TOKEN_PROGRAM_ID,manifest,recipient:holder,payer:authority.publicKey});
  const message=new TransactionMessage({payerKey:authority.publicKey,recentBlockhash:mint,instructions:[built.instruction]}).compileToV0Message();
  message.compiledInstructions[0].data=Uint8Array.from(message.compiledInstructions[0].data);
  const keys=message.staticAccountKeys.map(String),row=(address,owner,amount)=>({accountIndex:keys.indexOf(address),mint,owner,programId:TOKEN_PROGRAM_ID.toBase58(),uiTokenAmount:{amount}});
  const tx={transaction:{message,signatures:['receipt']},meta:{err:null,preBalances:keys.map(()=>0),
    preTokenBalances:[row(built.vaultToken,drop,'1000')],postTokenBalances:[row(built.vaultToken,drop,'250'),row(built.recipientToken,holder,'750')]}};
  const data=Buffer.alloc(92);createHash('sha256').update('account:CommunityPayment').digest().copy(data,0,0,8);
  new PublicKey(drop).toBuffer().copy(data,8);new PublicKey(holder).toBuffer().copy(data,40);data.writeBigUInt64LE(750n,72);data.writeUInt32LE(leaf.index,80);
  const connection={getTransaction:async(_sig,options)=>{assert.equal(options.commitment,'finalized');return tx;},getAccountInfo:async()=>({owner:new PublicKey(programId),data})};
  return {tx,data,input:{connection,signature:'receipt',built,programId,recipient:holder,index:leaf.index}};
}
test('automatic delivery pays the holding-weighted allocation with only the platform signer',async()=>{
  assert.equal(leaf.amount,'750');assert.equal(manifest.leaves.find(x=>x.recipient===other).amount,'250');
  const connection={getLatestBlockhash:async()=>({blockhash:mint,lastValidBlockHeight:1000}),getMinimumBalanceForRentExemption:async()=>1000000};
  let calls=0;
  const delivery=createCommunityAutoDelivery({connection,store:{},service:{recipientProof:async()=>({status:'claimable'})},authority,programId,approvedHash:'a'.repeat(64),
    execute:async input=>{calls++;const built=await input.prepare();assert.equal(built.transaction.message.header.numRequiredSignatures,1);
      assert.equal(String(built.transaction.message.staticAccountKeys[0]),String(authority.publicKey));
      assert.equal(input.intent.snapshotHash,manifest.snapshotHash);return {status:'verification-pending'};}});
  assert.equal((await delivery.pay(record,leaf)).status,'verification-pending');assert.equal(calls,1);
  await assert.rejects(delivery.pay({...record,snapshotBasis:'devnet-qa-cutoff'},leaf),/real migration/);
  const paid=createCommunityAutoDelivery({connection,store:{},service:{recipientProof:async()=>({status:'claimed'})},authority,programId,
    execute:()=>assert.fail('An already paid allocation must not be resubmitted')});
  assert.equal((await paid.pay(record,leaf)).status,'already-paid');
});
test('receipt proof requires exact recipient token delta, vault debit and immutable payment account',async()=>{
  const f=proofFixture();assert.equal((await verifyCommunityDelivery(f.input)).balanceDeltaVerified,true);
  for(const mutate of [f=>f.tx.meta.postTokenBalances[1].uiTokenAmount.amount='749',
    f=>f.tx.meta.postTokenBalances[1].owner=other,f=>f.tx.meta.preTokenBalances=undefined,
    f=>f.data.writeBigUInt64LE(749n,72),f=>f.tx.meta.err={InstructionError:[0,'failure']},
    f=>f.tx.transaction.message.compiledInstructions[0].data[8]^=1]){
    const bad=proofFixture();mutate(bad);await assert.rejects(verifyCommunityDelivery(bad.input));
  }
  const missing=proofFixture();missing.input.connection.getTransaction=async()=>null;
  assert.equal(await verifyCommunityDelivery(missing.input),null);
});
