import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,link,unlink,readFile,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {PublicKey,VersionedMessage} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {SOLANA_GENESIS} from '../solana-network.js';
import {decodeCommunityBankLayout} from './community-bank-layout.mjs';
import {reverseReplayCommunitySnapshot,verifyPumpMigrationTransaction} from './community-snapshot.mjs';
import {fenceRewardLedgerDirectory,rewardStoreFailure} from './reward-store-durability.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const key=v=>new PublicKey(v).toBase58();
function normalize(value,depth=0){
  assert(depth<=40,'Snapshot evidence nesting exceeds bound.');
  if(typeof value==='bigint')return String(value);
  if(value?.toBase58)return value.toBase58();
  if(value instanceof Uint8Array)return {$bytes:Buffer.from(value).toString('base64')};
  if(value instanceof Map)return [...value.entries()].sort(([a],[b])=>String(a).localeCompare(String(b)))
    .map(([k,v])=>[normalize(k,depth+1),normalize(v,depth+1)]);
  if(Array.isArray(value))return value.map(v=>normalize(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined)
    .map(k=>[k,normalize(value[k],depth+1)]));
  return value;
}
const canonical=value=>JSON.stringify(normalize(value));
function restore(value,depth=0){
  assert(depth<=40,'Snapshot evidence nesting exceeds bound.');
  if(Array.isArray(value))return value.map(v=>restore(v,depth+1));
  if(value&&typeof value==='object'){
    if(Object.keys(value).length===1&&typeof value.$bytes==='string'){
      const bytes=Buffer.from(value.$bytes,'base64');assert(bytes.toString('base64')===value.$bytes,'Noncanonical archived byte value.');return bytes;
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,restore(v,depth+1)]));
  }
  return value;
}
function rawAccount(row,program){
  assert(row?.account?.owner===program&&row.account.executable===false&&key(row.address)===row.address
    &&Number.isSafeInteger(row.account.lamports)&&row.account.lamports>0,'Raw finalized bank account header differs.');
  assert(typeof row.account.dataBase64==='string'&&row.account.dataBase64.length<=1_500_000,'Bounded raw bank account bytes required.');
  const data=Buffer.from(row.account.dataBase64,'base64');assert(data.toString('base64')===row.account.dataBase64,'Noncanonical bank bytes.');
  return data;
}

// This authenticates captured-input consistency against a trusted ledger hash,
// not a consensus state proof or independent live financial acceptance.
export function verifyCommunitySnapshotArchive(payload,expected={}){
  const {context:c,evidence:e,snapshot}=payload;
  assert(payload.version===1&&c&&Object.hasOwn(SOLANA_GENESIS,c.cluster)&&SOLANA_GENESIS[c.cluster]===c.genesisHash&&c.commitment==='finalized'
    &&c.snapshotBasis==='pump-migration'&&c.automaticDeliveryVersion===2
    &&/^[a-f0-9]{64}$/.test(c.expectedProgramDataSha256),'Bound finalized capture context required.');
  for(const name of ['programId','authority','creator','launchMint','eligibilityMint'])assert(key(c[name])===c[name],'Canonical capture identities required.');
  if(expected.context)assert(canonical(c)===canonical(expected.context),'Archive context differs from the saved immutable record.');
  const bank=e?.bankEvidence;
  assert(bank?.version===1&&bank.sameBank===true&&['indexed-atomic-bank','largest-atomic-bank'].includes(bank.source)
    &&Number.isSafeInteger(bank.slot)&&bank.slot===e.baseSlot&&bank.mintContextSlot===bank.slot,
    'Exact-bank archival evidence requires a common mint/account context; split reads are unqualified.');
  assert(bank.observedContext?.slot===bank.slot&&bank.readMethod==='getMultipleAccountsInfoAndContext'&&bank.commitment==='finalized',
    'Atomic finalized RPC bank provenance differs.');
  const program=bank.mint?.account?.owner;
  assert([String(TOKEN_PROGRAM_ID),String(TOKEN_2022_PROGRAM_ID)].includes(program)&&bank.mint.address===c.eligibilityMint&&e.mint===c.eligibilityMint,'Archive eligibility mint differs.');
  const mint=rawAccount(bank.mint,program);
  decodeCommunityBankLayout({data:mint,programId:program,address:bank.mint.address,kind:'mint'});
  assert(mint.length>=82&&mint[45]===1&&mint.readUInt32LE(0)===0,'Initialized fixed-supply archive mint required.');
  assert(Array.isArray(bank.accounts)&&bank.accounts.length>0&&bank.accounts.length<=100000,'Bounded complete raw base accounts required.');
  const seen=new Set(),rows=bank.accounts.map(row=>{
    const address=key(row.address);assert(!seen.has(address),'Duplicate raw base account.');seen.add(address);
    const data=rawAccount(row,program);decodeCommunityBankLayout({data,programId:program,address,kind:'account'});assert(data.length>=165&&[1,2].includes(data[108])&&key(data.subarray(0,32))===c.eligibilityMint,'Raw token account mint/layout differs.');
    return {account:address,wallet:key(data.subarray(32,64)),balance:String(data.readBigUInt64LE(64))};
  });
  assert(String(mint.readBigUInt64LE(36))===e.supplyBaseUnits
    &&rows.reduce((sum,row)=>sum+BigInt(row.balance),0n)===mint.readBigUInt64LE(36),'Raw bank does not cover complete fixed supply.');
  const sort=rows=>rows.map(row=>({account:key(row.account),wallet:key(row.wallet),balance:String(row.balance)})).sort((a,b)=>a.account.localeCompare(b.account));
  assert(canonical(sort(rows))===canonical(sort(e.baseAccounts)),'Normalized base differs from raw bank.');
  assert(typeof e.migrationMessageBase64==='string'&&e.migrationMessageBase64.length<=1644,'Signed migration message required.');
  const bytes=Buffer.from(e.migrationMessageBase64,'base64'),message=VersionedMessage.deserialize(bytes),keys=message.accountKeys||message.staticAccountKeys;
  const signatures=e.migrationTransaction?.transaction?.signatures,n=message.header.numRequiredSignatures;
  assert(bytes.toString('base64')===e.migrationMessageBase64&&Number.isSafeInteger(n)&&n>0&&n<=19&&1+64*n+bytes.length<=1232
    &&signatures?.length===n&&signatures[0]===c.migrationSignature
    &&signatures.every((signature,i)=>nacl.sign.detached.verify(bytes,bs58.decode(signature),keys[i].toBytes())),
    'Requested migration signature/message differs.');
  assert(canonical(e.migrationTransaction.transaction.message)===canonical(message),'Retained migration message differs from signed bytes.');
  const receipt={...e.migrationTransaction,transaction:{...e.migrationTransaction.transaction,message}};
  assert(receipt.meta?.err===null,'Successful finalized migration receipt required.');
  const cutoff=verifyPumpMigrationTransaction({transaction:receipt,launchMint:c.launchMint});
  assert(cutoff.slot===e.migrationSlot&&cutoff.blockTime===e.migrationBlockTime,'Migration cutoff context differs.');
  const status=e.migrationStatus?.value?.[0];
  assert(e.migrationStatus?.value?.length===1&&Number.isSafeInteger(e.migrationStatus.context?.slot)&&e.migrationStatus.context.slot>=cutoff.slot
    &&status?.slot===cutoff.slot&&status.err===null&&status.confirmationStatus==='finalized','Migration lacks matching captured finalized status.');
  const blocks=e.blocks instanceof Map?[...e.blocks]:e.blocks;
  assert(Array.isArray(blocks)&&blocks.length===e.blockSlots?.length,'Complete bounded replay input required.');
  const replay=reverseReplayCommunitySnapshot({...e,baseAccounts:rows,blocks:new Map(blocks)});
  assert(canonical(replay)===canonical(snapshot),'Archive replay differs from captured eligibility.');
  if(expected.snapshot)assert(canonical(snapshot)===canonical(expected.snapshot),'Archive snapshot differs from saved immutable record.');
  return {context:c,snapshot:replay,qualifiedExactBank:true};
}

export function createCommunitySnapshotArchive({directory,maxBytes=32*1024*1024}){
  assert(directory&&Number.isSafeInteger(maxBytes)&&maxBytes>=1024&&maxBytes<=128*1024*1024,'Explicit bounded archive directory required.');
  const root=resolve(directory);
  const file=sha=>{assert(/^[a-f0-9]{64}$/.test(sha),'Canonical snapshot archive hash required.');return join(root,sha+'.json');};
  async function read(pointer,expected){
    const path=file(pointer.sha256),info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink()
      &&info.size===pointer.bytes&&info.size<=maxBytes,'Archive file identity/size differs.');
    const bytes=await readFile(path);assert(digest(bytes)===pointer.sha256,'Snapshot archive hash differs.');
    const payload=restore(JSON.parse(bytes.toString('utf8')));
    assert(pointer.version===1&&pointer.baseSlot===payload.evidence?.baseSlot&&pointer.migrationSlot===payload.evidence?.migrationSlot
      &&pointer.expectedProgramDataSha256===payload.context?.expectedProgramDataSha256,'Archive pointer context differs.');
    return verifyCommunitySnapshotArchive(payload,expected);
  }
  return {identity:digest(root),read,async save({context,evidence,snapshot}){
    const payload={version:1,context,evidence,snapshot};verifyCommunitySnapshotArchive(payload);
    const bytes=Buffer.from(canonical(payload));assert(bytes.length<=maxBytes,'Snapshot archive exceeds byte budget.');
    const sha=digest(bytes),pointer={version:1,sha256:sha,bytes:bytes.length,baseSlot:evidence.baseSlot,migrationSlot:evidence.migrationSlot,
      expectedProgramDataSha256:context.expectedProgramDataSha256};
    let temp,handle,rootReady=false;const errors=[];
    try{
      await mkdir(root,{recursive:true,mode:0o700});rootReady=true;
      assert(await realpath(root)===root,'Archive directory must not be a symbolic alias.');
      temp=join(root,'.'+randomUUID()+'.tmp');handle=await open(temp,'wx',0o600);
      await handle.writeFile(bytes);await handle.sync();
    }catch(error){errors.push(error);}
    if(handle)try{await handle.close();}catch(error){errors.push(error);}
    if(errors.length===0)try{
      try{await link(temp,file(sha));}catch(error){if(error.code!=='EEXIST')throw error;}
      await read(pointer,{context,snapshot});
    }catch(error){errors.push(error);}
    if(temp)try{await unlink(temp);}catch(error){if(error.code!=='ENOENT')errors.push(error);}
    // The archive is linked before its ledger pointer is published. Fence the
    // leaf directory and newly created same-device ancestors after cleanup.
    if(rootReady)try{await fenceRewardLedgerDirectory(root);}catch(error){errors.push(error);}
    if(errors.length)throw rewardStoreFailure(errors);
    pointer.publication={fileFsync:true,directoryFsync:process.platform!=='win32'};return pointer;
  }};
}
