import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {TOKEN_2022_PROGRAM_ID,ExtensionType,getTypeLen} from '@solana/spl-token';
import {pack as packMetadata} from '@solana/spl-token-metadata';
import {communityArchiveFixture} from './community-archive-fixture.mjs';
import {verifyCommunitySnapshotArchive} from '../../server/community-snapshot-archive.mjs';
const tlv=(type,value)=>{const header=Buffer.alloc(4);header.writeUInt16LE(type);header.writeUInt16LE(value.length,2);return Buffer.concat([header,value]);};
function token2022(f,extended){
  f.mintInfo.owner=TOKEN_2022_PROGRAM_ID;for(const row of f.tokenInfos)row.owner=TOKEN_2022_PROGRAM_ID;
  if(extended){
    const metadata=packMetadata({mint:f.eligibility,name:'Unit archive',symbol:'UNIT',uri:'offline:unit',additionalMetadata:[]});
    const pointer=Buffer.alloc(getTypeLen(ExtensionType.MetadataPointer));f.eligibility.toBuffer().copy(pointer,32);
    f.mintInfo.data=Buffer.concat([f.mintInfo.data,Buffer.alloc(83),Buffer.from([1]),tlv(ExtensionType.MetadataPointer,pointer),tlv(ExtensionType.TokenMetadata,metadata)]);
    for(const row of f.tokenInfos)row.data=Buffer.concat([row.data,Buffer.from([2]),tlv(ExtensionType.ImmutableOwner,Buffer.alloc(0)),tlv(ExtensionType.TransferFeeAmount,Buffer.alloc(8))]);
    f.tokenInfos[0].data[108]=2; // frozen is a valid bank state
  }
}
for(const extended of [false,true])test(`Token2022 ${extended?'extended metadata and account':'base'} bank publishes and replays offline`,async t=>{
  const f=await communityArchiveFixture(t);token2022(f,extended);const record=await f.service().prepare(f.input);
  for(const name of Object.keys(f.connection))if(typeof f.connection[name]==='function')f.connection[name]=async()=>{throw Error('No current bank/RPC');};
  assert.deepEqual(await f.reopen().prepared(f.launch),record);assert.equal(record.snapshotEvidence.publication.fileFsync,true);
});
for(const mode of ['classic mint trailing','classic account trailing','classic extended type'])test(`publication refuses ${mode} without prepared reference`,async t=>{
  const f=await communityArchiveFixture(t);
  if(mode==='classic mint trailing')f.mintInfo.data=Buffer.concat([f.mintInfo.data,Buffer.from([99])]);
  if(mode==='classic account trailing')f.tokenInfos[0].data=Buffer.concat([f.tokenInfos[0].data,Buffer.from([99])]);
  if(mode==='classic extended type')f.tokenInfos[0].data=Buffer.concat([f.tokenInfos[0].data,Buffer.from([2])]);
  await assert.rejects(f.service().prepare(f.input));assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});

test('extended bank rejects malformed type padding TLV size ownership and COption structures',async t=>{
  const f=await communityArchiveFixture(t);token2022(f,true);const record=await f.service().prepare(f.input),original=await readFile(join(f.directory,record.snapshotEvidence.sha256+'.json'),'utf8');
  const edit=(p,mint,mutate)=>{const row=mint?p.evidence.bankEvidence.mint:p.evidence.bankEvidence.accounts[0];row.account.dataBase64=mutate(Buffer.from(row.account.dataBase64,'base64')).toString('base64');};
  const mutations=[
    [true,b=>{b[165]=2;return b;}],[false,b=>{b[165]=1;return b;}],
    [true,b=>{b[82]=1;return b;}],[true,b=>{b.writeUInt32LE(2,46);return b;}],
    [false,b=>{b.writeUInt32LE(2,72);return b;}],[false,b=>{b.writeUInt32LE(2,109);return b;}],[false,b=>{b.writeUInt32LE(2,129);return b;}],
    [true,b=>b.subarray(0,b.length-1)],[false,b=>b.subarray(0,b.length-1)],
    [true,b=>{b.writeUInt16LE(65535,166);return b;}],[false,b=>{b.writeUInt16LE(65535,168);return b;}],
    [true,b=>{b.writeUInt16LE(ExtensionType.ImmutableOwner,166);return b;}],
    [false,b=>{b.writeUInt16LE(ExtensionType.MetadataPointer,166);return b;}],
    [false,b=>Buffer.concat([b,tlv(ExtensionType.ImmutableOwner,Buffer.alloc(0))])],
    [true,b=>{b.writeUInt16LE(63,168);return b;}]
  ];
  for(const [mint,mutate] of mutations){const p=JSON.parse(original);edit(p,mint,mutate);assert.throws(()=>verifyCommunitySnapshotArchive(p));}
});

test('valid hash cannot qualify a malformed Token2022 account after restart',async t=>{
  const f=await communityArchiveFixture(t);token2022(f,true);const r=await f.service().prepare(f.input),p=JSON.parse(await readFile(join(f.directory,r.snapshotEvidence.sha256+'.json'),'utf8'));
  const row=p.evidence.bankEvidence.accounts[0],b=Buffer.from(row.account.dataBase64,'base64');b.writeUInt16LE(65535,168);row.account.dataBase64=b.toString('base64');
  const bytes=Buffer.from(JSON.stringify(p)),sha=createHash('sha256').update(bytes).digest('hex');await writeFile(join(f.directory,sha+'.json'),bytes);
  await f.store.transaction(s=>Object.assign(s.communityDrops[String(f.launch)].snapshotEvidence,{sha256:sha,bytes:bytes.length}));
  for(const name of Object.keys(f.connection))if(typeof f.connection[name]==='function')f.connection[name]=async()=>{throw Error('No recapture');};
  await assert.rejects(f.reopen().prepared(f.launch),/extension/);
});
