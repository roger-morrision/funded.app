import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,Transaction,TransactionInstruction,VersionedTransaction,TransactionMessage,AddressLookupTableAccount} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token';
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import {join,resolve,sep} from 'node:path';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {createCommunityClaimService} from '../../server/community-claim-service.mjs';
import {createCommunitySnapshotArchive} from '../../server/community-snapshot-archive.mjs';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';

const key=n=>Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
const disc=name=>createHash('sha256').update('global:'+name).digest().subarray(0,8);
export async function communityArchiveFixture(t){
  assert(!process.env.FUNDED_COMMUNITY_SNAPSHOT_ARCHIVE_DIR,'Fixture requires an explicit isolated archive directory.');
  const eligibility=key(21),launch=key(22),authority=key(23),program=key(24),signer=Keypair.fromSeed(new Uint8Array(32).fill(25));
  const wallets=[key(26),key(27)],addresses=[key(28),key(29)],pool=canonicalPumpPoolPda(launch,NATIVE_MINT),migrationSlot=1000,baseSlot=1002;
  const tx=new Transaction({feePayer:signer.publicKey,recentBlockhash:String(key(30))}).add(new TransactionInstruction({programId:PUMP_PROGRAM_ID,
    keys:[launch,pool,PUMP_AMM_PROGRAM_ID,NATIVE_MINT].map(pubkey=>({pubkey,isSigner:false,isWritable:false})),data:disc('migrate_v2')}));
  tx.sign(signer);const message=tx.compileMessage(),index=k=>message.accountKeys.findIndex(p=>p.equals(k)),migrationSignature=bs58.encode(tx.signature);
  const transaction={slot:migrationSlot,blockTime:1795000000,transaction:{signatures:[migrationSignature],message},meta:{err:null,
    innerInstructions:[{index:0,instructions:[{programIdIndex:index(PUMP_AMM_PROGRAM_ID),accounts:[index(pool),0,0,index(launch),index(NATIVE_MINT)],data:bs58.encode(disc('create_pool'))}]}]}};
  const mintData=Buffer.alloc(82);mintData[44]=6;mintData[45]=1;mintData.writeBigUInt64LE(100n,36);
  const info=data=>({owner:TOKEN_PROGRAM_ID,executable:false,lamports:2000000,data:Buffer.from(data)}),mintInfo=info(mintData);
  const tokenInfos=wallets.map((wallet,i)=>{const d=Buffer.alloc(165);eligibility.toBuffer().copy(d);wallet.toBuffer().copy(d,32);d.writeBigUInt64LE([60n,40n][i],64);d[108]=1;return info(d);});
  const balances=amounts=>amounts.map((n,i)=>({accountIndex:i,mint:String(eligibility),owner:String(wallets[i]),uiTokenAmount:{amount:String(n)}}));
  const transfer={transaction:{message:{accountKeys:addresses}},meta:{err:null,preTokenBalances:balances([90,10]),postTokenBalances:balances([60,40])}};
  const blocks=new Map([[1001,{parentSlot:1000,blockhash:String(key(31)),previousBlockhash:String(key(32)),transactions:[transfer]}],
    [1002,{parentSlot:1001,blockhash:String(key(33)),previousBlockhash:String(key(31)),transactions:[]}]]);
  const f={eligibility,launch,authority,program,migrationSignature,transaction,mintInfo,tokenInfos,addresses,blocks,migrationSlot,baseSlot,reads:0,fallback:false};
  const connection={getGenesisHash:async()=>SOLANA_GENESIS.devnet,getTransaction:async()=>{f.reads++;return transaction;},
    getSignatureStatuses:async signatures=>{assert.deepEqual(signatures,[f.migrationSignature]);return{context:{slot:baseSlot},value:[{slot:migrationSlot,err:null,confirmationStatus:'finalized',confirmations:null}]};},
    getAccountInfo:async address=>{f.reads++;if(address.equals(eligibility)||address.equals(launch))return mintInfo;if(address.equals(pool))return{owner:PUMP_AMM_PROGRAM_ID};return null;},
    getSlot:async()=>baseSlot,getTokenLargestAccounts:async()=>{if(f.fallback)throw Error('Use program-list fallback');return{context:{slot:baseSlot},value:addresses.map(address=>({address}))};},
    getMultipleAccountsInfoAndContext:async keys=>{assert.deepEqual(keys.map(String),[eligibility,...addresses].map(String));return{context:{slot:baseSlot},value:[mintInfo,...tokenInfos]};},
    getProgramAccounts:async()=>({context:{slot:baseSlot},value:addresses.map((pubkey,i)=>({pubkey,account:tokenInfos[i]}))}),
    getBlocks:async()=>[1001,1002],getParsedBlock:async slot=>blocks.get(slot)};
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-community-archive-'));
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert.ok(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const path=join(dir,'ledger.json'),store=createAutomaticRewardStore(path),directory=join(dir,'archives');
  f.archive=createCommunitySnapshotArchive({directory});f.directory=directory;f.store=store;f.path=path;f.connection=connection;
  f.input={mint:String(launch),creator:String(authority),reservedTokens:1,fundingSignature:'mocked-reserve-not-financial-proof',migrationSignature};
  f.useV0=()=>{
    const table=new AddressLookupTableAccount({key:key(35),state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,
      authority:signer.publicKey,addresses:[launch,pool,PUMP_AMM_PROGRAM_ID,NATIVE_MINT]}});
    const versioned=new VersionedTransaction(new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:String(key(30)),instructions:tx.instructions}).compileToV0Message([table]));
    versioned.sign([signer]);const m=versioned.message,loaded=m.resolveAddressTableLookups([table]),all=[...m.staticAccountKeys,...loaded.writable,...loaded.readonly],at=k=>all.findIndex(p=>p.equals(k));
    transaction.transaction={signatures:[bs58.encode(versioned.signatures[0])],message:m};transaction.meta.loadedAddresses=loaded;
    transaction.meta.innerInstructions=[{index:0,instructions:[{programIdIndex:at(PUMP_AMM_PROGRAM_ID),accounts:[at(pool),0,0,at(launch),at(NATIVE_MINT)],data:bs58.encode(disc('create_pool'))}]}];
    f.migrationSignature=transaction.transaction.signatures[0];f.input.migrationSignature=f.migrationSignature;
  };
  f.service=(options={})=>createCommunityClaimService({connection,store:options.store||store,programId:program,authority,eligibilityMint:eligibility,
    cluster:'devnet',expectedCommunityProgramDataSha256:'11'.repeat(32),snapshotArchive:f.archive,
    // Funding verification is explicitly outside this raw capture test scope.
    reserveReader:async()=>({status:'funded',verified:true}),...options});
  f.reopen=()=>f.service({store:createAutomaticRewardStore(path),snapshotArchive:createCommunitySnapshotArchive({directory})});
  return f;
}
