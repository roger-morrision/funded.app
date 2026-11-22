import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,PublicKey} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {createCommunityClaimService} from '../../server/community-claim-service.mjs';
import {indexCommunityClaims} from '../../server/community-claim-index.mjs';
import {communityAddresses} from '../../server/community-claim-chain.mjs';
import {buildCommunityManifest} from '../../community-merkle.js';

test('old community drop remains openable and claimable after the service RICH mint rotates',async()=>{
  const programId=Keypair.generate().publicKey,authority=Keypair.generate().publicKey;
  const appOwner=Keypair.generate().publicKey,creator=Keypair.generate().publicKey;
  const launchMint=Keypair.generate().publicKey,oldRich=Keypair.generate().publicKey;
  const newRich=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey;
  const migrationSignature=bs58.encode(Buffer.alloc(64,7));
  const snapshot={finalized:true,coverage:'finalized-exact-slot-v1',slot:123,
    blockTime:Math.floor(Date.now()/1000)-100,mint:String(oldRich),supplyBaseUnits:'1000',
    accounts:[{wallet:String(recipient),balance:'1000'}]};
  const {drop}=communityAddresses({programId,authority,mint:launchMint});
  const manifest=buildCommunityManifest({drop:String(drop),launchMint:String(launchMint),eligibilityMint:String(oldRich),
    migrationSignature,migrationSlot:snapshot.slot,migrationBlockTime:snapshot.blockTime,snapshot,
    amountBaseUnits:'1000000'});
  const record={cluster:'devnet',snapshotBasis:'pump-migration',mint:String(launchMint),creator:String(creator),
    reservedTokens:1,fundingSignature:'funding-receipt',migrationSignature,eligibilityMint:String(oldRich),
    programId:String(programId),authority:String(authority),tokenProgram:String(TOKEN_2022_PROGRAM_ID),
    reservedBaseUnits:'1000000',snapshot,manifest,openingSignature:null};
  const observed=[];
  const programData=Buffer.alloc(45);programData[12]=1;appOwner.toBuffer().copy(programData,13);
  const service=createCommunityClaimService({
    connection:{getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      getTokenAccountBalance:async()=>({value:{amount:'1000000'}}),getAccountInfo:async()=>null},
    store:{read:async()=>({communityDrops:{[record.mint]:record}}),transaction:async()=>{throw Error('Already prepared record must not be replaced.');}},
    programId,authority,eligibilityMint:newRich,expectedCommunityProgramDataSha256:'a'.repeat(64),
    programEvidence:async()=>({account:{executable:true},sha256:'a'.repeat(64),
      programDataAddress:String(Keypair.generate().publicKey),programData:{data:programData}}),
    reserveReader:async input=>{observed.push(String(input.expectedEligibilityMint));return input.dropOpeningSignature
      ?{status:'drop-active',verified:true,merkleRoot:manifest.root,snapshotHash:manifest.snapshotHash,
        migrationSlot:snapshot.slot,expiresAt:snapshot.blockTime+90*86400}
      :{status:'funded',verified:true};},
  });
  const prior=await service.prepare({mint:String(launchMint),creator:String(creator),reservedTokens:1,
    fundingSignature:record.fundingSignature,migrationSignature});
  assert.equal(prior.eligibilityMint,String(oldRich));
  const opening=await service.openingInstruction(launchMint);
  assert.ok(opening.instruction.keys[4].pubkey.equals(oldRich));
  const approval=await service.approvalInstruction({mint:launchMint,appOwner});
  assert.ok(approval.keys[4].pubkey.equals(oldRich));
  record.openingSignature='finalized-opening-receipt';
  const proof=await service.recipientProof({mint:launchMint,wallet:recipient});
  assert.equal(proof.status,'claimable');
  assert.deepEqual(observed,[String(oldRich),String(oldRich)]);
  const bytes=Buffer.alloc(350);
  createHash('sha256').update('account:CommunityDrop').digest().subarray(0,8).copy(bytes);
  authority.toBuffer().copy(bytes,8);authority.toBuffer().copy(bytes,72);
  launchMint.toBuffer().copy(bytes,104);oldRich.toBuffer().copy(bytes,136);
  Buffer.from(manifest.root,'hex').copy(bytes,168);
  Buffer.from(manifest.snapshotHash,'hex').copy(bytes,200);
  bytes.writeBigUInt64LE(1_000_000n,312);bytes.writeUInt32LE(1,344);
  const index=await indexCommunityClaims({
    connection:{getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      getAccountInfo:async()=>({owner:programId,data:bytes}),
      getMultipleAccountsInfo:async keys=>keys.map(()=>null)},
    ledger:{read:async()=>({communityDrops:{[record.mint]:record}})},programId,authority,
    eligibilityMint:newRich,expectedProgramDataSha256:'a'.repeat(64),
    programEvidence:async()=>({account:{executable:true},sha256:'a'.repeat(64)}),persist:false});
  assert.equal(index.drops[0].eligibilityMint,String(oldRich));
});

test('a newly prepared drop snapshots the newly configured RICH mint',async()=>{
  const programId=Keypair.generate().publicKey,authority=Keypair.generate().publicKey;
  const creator=Keypair.generate().publicKey,launchMint=Keypair.generate().publicKey;
  const newRich=Keypair.generate().publicKey,holder=Keypair.generate().publicKey;
  const migrationSignature=bs58.encode(Buffer.alloc(64,8));
  const snapshot={finalized:true,coverage:'finalized-exact-slot-v1',slot:456,
    blockTime:Math.floor(Date.now()/1000)-100,mint:String(newRich),supplyBaseUnits:'1000',
    accounts:[{wallet:String(holder),balance:'1000'}]};
  const mintData=Buffer.alloc(82);mintData[44]=6;
  const state={communityDrops:{}},observed=[];
  const service=createCommunityClaimService({
    connection:{getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      getAccountInfo:async key=>new PublicKey(key).equals(launchMint)?{owner:TOKEN_2022_PROGRAM_ID,data:mintData}:null},
    store:{read:async()=>state,transaction:async update=>update(state)},
    programId,authority,eligibilityMint:newRich,expectedCommunityProgramDataSha256:'a'.repeat(64),
    captureSnapshot:async input=>{assert.ok(input.mint.equals(newRich));return snapshot;},
    reserveReader:async input=>{observed.push(String(input.expectedEligibilityMint));return{status:'funded',verified:true};},
  });
  const prepared=await service.prepare({mint:String(launchMint),creator:String(creator),reservedTokens:1,
    fundingSignature:'funding-receipt',migrationSignature});
  assert.equal(prepared.eligibilityMint,String(newRich));
  assert.equal(prepared.manifest.eligibilityMint,String(newRich));
  assert.deepEqual(observed,[String(newRich)]);
});
