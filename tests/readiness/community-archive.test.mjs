import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readIndexedCommunityBase} from '../../server/community-indexed-base.mjs';
import {verifyCommunitySnapshotArchive,createCommunitySnapshotArchive} from '../../server/community-snapshot-archive.mjs';
import {captureExactCommunitySnapshot} from '../../server/community-snapshot.mjs';
import {communityArchiveFixture} from './community-archive-fixture.mjs';

test('prepareFresh durably publishes raw atomic bank evidence then replays after restart without RPC',async t=>{
  const f=await communityArchiveFixture(t),record=await f.service().prepare(f.input);assert.equal(record.snapshotEvidence.baseSlot,1002);
  assert.equal(record.snapshotEvidence.publication.fileFsync,true);assert.equal(typeof record.snapshotEvidence.publication.directoryFsync,'boolean');
  const path=join(f.directory,record.snapshotEvidence.sha256+'.json'),bytes=await readFile(path);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.snapshotEvidence.sha256);
  const data=JSON.parse(bytes);assert.equal(data.evidence.bankEvidence.source,'largest-atomic-bank');assert.equal(data.evidence.bankEvidence.mintContextSlot,1002);
  assert.equal(data.evidence.bankEvidence.accounts.length,2);assert.ok(data.evidence.bankEvidence.accounts[0].account.dataBase64);
  for(const name of Object.keys(f.connection))if(typeof f.connection[name]==='function')f.connection[name]=async()=>{throw Error('No current RPC/balance substitution');};
  const again=await f.reopen().prepared(f.launch);assert.deepEqual(again,record);assert.deepEqual(again.snapshot.accounts.map(r=>r.balance).sort(),['10','90']);assert.equal(again.manifest.root,record.manifest.root);
});

test('split-read program fallback preserves legacy capture but cannot qualify an exact-bank archive',async t=>{
  const f=await communityArchiveFixture(t);f.fallback=true;let evidence;
  const snapshot=await captureExactCommunitySnapshot({connection:f.connection,mint:f.eligibility,launchMint:f.launch,migrationSignature:f.migrationSignature,onEvidence:e=>{evidence=e;}});
  assert.equal(snapshot.slot,1000);assert.equal(evidence.bankEvidence.sameBank,false);assert.equal(evidence.bankEvidence.mintContextSlot,null);
  await assert.rejects(f.service().prepare(f.input),/common mint\/account context/);assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
  assert.equal((await readdir(f.directory).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))).length,0);
  const legacy=await f.service({snapshotArchive:null}).prepare(f.input);assert.equal(legacy.snapshot.slot,1000);assert.equal(legacy.snapshotEvidence,undefined);
});

test('indexed base retains mint and token bytes from the same atomic context',async t=>{
  const f=await communityArchiveFixture(t),connection={...f.connection,rpcEndpoint:'https://offline.invalid'};
  const base=await readIndexedCommunityBase({connection,mintKey:f.eligibility,retainEvidence:true,fetchImpl:async()=>({ok:true,json:async()=>({result:{token_accounts:f.addresses.map(address=>({address:String(address)}))}})})});
  assert.equal(base.bankEvidence.sameBank,true);assert.equal(base.bankEvidence.source,'indexed-atomic-bank');assert.equal(base.bankEvidence.mintContextSlot,base.slot);
  assert.equal(Buffer.from(base.bankEvidence.mint.account.dataBase64,'base64').readBigUInt64LE(36),100n);
});

test('damaged file hash cannot become a prepared record after restart',async t=>{
  const f=await communityArchiveFixture(t),r=await f.service().prepare(f.input),path=join(f.directory,r.snapshotEvidence.sha256+'.json');
  const bytes=await readFile(path);bytes[bytes.length-2]^=1;await writeFile(path,bytes);await assert.rejects(f.reopen().prepared(f.launch),/hash/);
});

test('valid-content hashes do not authenticate changed network signature raw owner or missing history',async t=>{
  const f=await communityArchiveFixture(t),r=await f.service().prepare(f.input),bytes=await readFile(join(f.directory,r.snapshotEvidence.sha256+'.json'));
  for(const change of [p=>{p.context.genesisHash='wrong';},p=>{p.context.migrationSignature='wrong';},p=>{p.evidence.migrationTransaction.transaction.signatures[0]='wrong';},
    p=>{p.evidence.migrationTransaction.transaction.signatures.push(p.context.migrationSignature);},
    p=>{p.evidence.migrationTransaction.transaction.message.recentBlockhash='wrong';},
    p=>{p.evidence.migrationTransaction.meta.err=false;},
    p=>{p.evidence.bankEvidence.accounts[0].account.owner=String(f.program);},p=>{p.evidence.bankEvidence.accounts.pop();},p=>{p.evidence.blocks.shift();},
    p=>{p.evidence.bankEvidence.mintContextSlot--;},p=>{p.evidence.baseAccounts[0].balance='61';}]){
    const payload=JSON.parse(bytes);change(payload);assert.throws(()=>verifyCommunitySnapshotArchive(payload));
  }
});

test('archive publication rejection prevents prepared ledger state',async t=>{
  const f=await communityArchiveFixture(t),archive={...f.archive,save:async()=>{throw Error('durable write rejected');}};
  await assert.rejects(f.service({snapshotArchive:archive}).prepare(f.input),/durable write rejected/);assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});

test('existing aggregate-only record is not silently backfilled from current balances',async t=>{
  const f=await communityArchiveFixture(t),record=await f.service({snapshotArchive:null}).prepare(f.input);assert.equal(record.snapshotEvidence,undefined);
  const count=f.reads;await assert.rejects(f.service().prepare(f.input),/cannot be recaptured/);assert.equal(f.reads,count);
});

test('archive save is idempotent and expired claim settings survive offline replay',async t=>{
  const f=await communityArchiveFixture(t),record=await f.service().prepare(f.input),payload=JSON.parse(await readFile(join(f.directory,record.snapshotEvidence.sha256+'.json'),'utf8'));
  // JSON-normalized migration/transaction data contains only public facts.
  payload.evidence.blocks=new Map(payload.evidence.blocks.slice().reverse());
  const second=await f.archive.save(payload);assert.equal(second.sha256,record.snapshotEvidence.sha256);
  const reopened=await f.reopen().prepared(f.launch);assert.equal(reopened.manifest.expiresAt,record.manifest.expiresAt);assert.equal(reopened.openingSignature,null);
});

test('nested archive publication fences the directory before returning its durable pointer',async t=>{
  const f=await communityArchiveFixture(t),directory=join(f.directory,'new-parent','new-leaf');
  const archive=createCommunitySnapshotArchive({directory});
  const record=await f.service({snapshotArchive:archive}).prepare(f.input);
  assert.equal(record.snapshotEvidence.publication.fileFsync,true);
  assert.equal(record.snapshotEvidence.publication.directoryFsync,process.platform!=='win32');
  assert.deepEqual((await readdir(directory)).filter(name=>name.endsWith('.tmp')),[]);
  const reopened=f.service({snapshotArchive:createCommunitySnapshotArchive({directory}),store:f.store});
  assert.deepEqual(await reopened.prepared(f.launch),record);
});

test('a corrupt existing content-addressed file refuses idempotent publication and cleans the temp file',async t=>{
  const f=await communityArchiveFixture(t),record=await f.service().prepare(f.input);
  const path=join(f.directory,record.snapshotEvidence.sha256+'.json'),original=await readFile(path);
  const payload=JSON.parse(original);await writeFile(path,Buffer.from('{}'));
  await assert.rejects(f.archive.save(payload),/Archive file identity\/size differs/);
  assert.deepEqual((await readdir(f.directory)).filter(name=>name.endsWith('.tmp')),[]);
  assert.equal((await readFile(path,'utf8')),'{}');
});

test('indexed capture qualifies through prepareFresh durable publication and offline restart',async t=>{
  const f=await communityArchiveFixture(t);f.connection.rpcEndpoint='https://offline.invalid';
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({result:{token_accounts:f.addresses.map(address=>({address:String(address)}))}})}));
  f.connection.getTokenLargestAccounts=async()=>{throw Error('Indexed path must be retained');};
  const record=await f.service().prepare(f.input),payload=JSON.parse(await readFile(join(f.directory,record.snapshotEvidence.sha256+'.json'),'utf8'));
  assert.equal(payload.evidence.bankEvidence.source,'indexed-atomic-bank');assert.equal(payload.evidence.bankEvidence.observedContext.slot,1002);
  f.connection.getMultipleAccountsInfoAndContext=async()=>{throw Error('No bank recapture on restart');};assert.deepEqual(await f.reopen().prepared(f.launch),record);
});

test('archival replay does not make an unopened drop claimable',async t=>{
  const f=await communityArchiveFixture(t);await f.service().prepare(f.input);
  const service=f.service({programEvidence:async()=>({account:{executable:true},sha256:'11'.repeat(32)})});
  const record=await service.prepared(f.launch),result=await service.recipientProof({mint:f.launch,wallet:record.manifest.leaves[0].recipient});
  assert.equal(result.status,'unavailable');assert.match(result.reason,/opening receipt/);
});

test('offline archive replay preserves an expired claim deadline without reopening',async t=>{
  const f=await communityArchiveFixture(t);f.transaction.blockTime=1700000000;const record=await f.service().prepare(f.input);
  await f.store.transaction(s=>{s.communityDrops[String(f.launch)].openingSignature='mocked-existing-opening-outside-archive-scope';});
  const service=f.service({programEvidence:async()=>({account:{executable:true},sha256:'11'.repeat(32)}),reserveReader:async()=>({verified:true,status:'drop-active',
    merkleRoot:record.manifest.root,snapshotHash:record.manifest.snapshotHash,migrationSlot:record.snapshot.slot,expiresAt:record.manifest.expiresAt})});
  assert.equal((await service.recipientProof({mint:f.launch,wallet:record.manifest.leaves[0].recipient})).status,'expired');
  await assert.rejects(service.claimInstruction({mint:f.launch,wallet:record.manifest.leaves[0].recipient}),/No verified unclaimed/);
  assert.equal((await f.reopen().prepared(f.launch)).manifest.expiresAt,record.manifest.expiresAt);
});

test('requested migration identity mismatch cannot publish through prepareFresh',async t=>{
  const f=await communityArchiveFixture(t);f.transaction.transaction.signatures[0]='wrong';
  await assert.rejects(f.service().prepare(f.input),/signature\/message/);assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});

test('a valid file hash still rejects mismatched retained transaction ID during offline restart',async t=>{
  const f=await communityArchiveFixture(t),r=await f.service().prepare(f.input),payload=JSON.parse(await readFile(join(f.directory,r.snapshotEvidence.sha256+'.json'),'utf8'));
  payload.evidence.migrationTransaction.transaction.signatures[0]='wrong';const bytes=Buffer.from(JSON.stringify(payload)),sha=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(f.directory,sha+'.json'),bytes);await f.store.transaction(s=>{Object.assign(s.communityDrops[String(f.launch)].snapshotEvidence,{sha256:sha,bytes:bytes.length});});
  f.connection.getTransaction=async()=>{throw Error('No fresh transaction substitution');};await assert.rejects(f.reopen().prepared(f.launch),/signature\/message/);
});

test('raw bank flags authority layout supply and duplicate identities are checked on ingestion',async t=>{
  const f=await communityArchiveFixture(t),r=await f.service().prepare(f.input),original=await readFile(join(f.directory,r.snapshotEvidence.sha256+'.json'),'utf8');
  const bytes=(p,which,edit)=>{const row=which==='mint'?p.evidence.bankEvidence.mint:p.evidence.bankEvidence.accounts[0];const b=Buffer.from(row.account.dataBase64,'base64');edit(b);row.account.dataBase64=b.toString('base64');};
  for(const change of [p=>{p.evidence.bankEvidence.accounts[0].account.executable=true;},p=>{p.evidence.bankEvidence.accounts.push(p.evidence.bankEvidence.accounts[0]);},
    p=>{p.evidence.bankEvidence.accounts[0].account.lamports=0;},
    p=>bytes(p,'mint',b=>b.writeUInt32LE(1,0)),p=>bytes(p,'mint',b=>b.writeBigUInt64LE(101n,36)),p=>bytes(p,'token',b=>{b[108]=0;}),p=>bytes(p,'token',b=>{b[108]=3;}),p=>bytes(p,'token',b=>{b[0]^=1;})]){
    const payload=JSON.parse(original);change(payload);assert.throws(()=>verifyCommunitySnapshotArchive(payload));
  }
});

test('filesystem publication failure does not persist a prepared archive reference',async t=>{
  const f=await communityArchiveFixture(t),blocked=join(f.directory+'.blocked');await writeFile(blocked,'not a directory');
  const archive=createCommunitySnapshotArchive({directory:blocked});await assert.rejects(f.service({snapshotArchive:archive}).prepare(f.input));
  assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});

test('pointer context corruption and missing configured verifier fail closed after restart',async t=>{
  const f=await communityArchiveFixture(t),r=await f.service().prepare(f.input);
  await assert.rejects(f.service({snapshotArchive:null}).prepared(f.launch),/archive verifier/);
  await f.store.transaction(s=>{s.communityDrops[String(f.launch)].snapshotEvidence.baseSlot++;});await assert.rejects(f.reopen().prepared(f.launch),/pointer context/);
  assert.equal(r.openingSignature,null);
});

test('a capture that omits raw evidence cannot publish an archive reference',async t=>{
  const f=await communityArchiveFixture(t);
  await assert.rejects(f.service({captureSnapshot:args=>captureExactCommunitySnapshot({...args,onEvidence:undefined})}).prepare(f.input),/raw capture evidence/);
  assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});

test('saved archive binds rebuilt allocations root amount and original deadline',async t=>{
  for(const field of ['leaf','root','amount','deadline','funding','basis']){
    const f=await communityArchiveFixture(t);await f.service().prepare(f.input);
    await f.store.transaction(s=>{const r=s.communityDrops[String(f.launch)];
      if(field==='leaf')r.manifest.leaves[0].amount=String(BigInt(r.manifest.leaves[0].amount)+1n);
      if(field==='root')r.manifest.root='00'.repeat(32);if(field==='amount')r.reservedBaseUnits='1000001';if(field==='deadline')r.manifest.expiresAt++;
      if(field==='funding')r.fundingSignature='changed';if(field==='basis')r.snapshotBasis='devnet-qa-cutoff';});
    await assert.rejects(f.reopen().prepared(f.launch),/manifest differs|context differs|migration mode differs/);
  }
});

test('explicit archive byte budget fails before any ledger publication',async t=>{
  const f=await communityArchiveFixture(t),archive=createCommunitySnapshotArchive({directory:f.directory,maxBytes:1024});
  await assert.rejects(f.service({snapshotArchive:archive}).prepare(f.input),/byte budget/);assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});

test('configured storage path uses the actual service archive factory without enabling a new worker',async t=>{
  const f=await communityArchiveFixture(t),previous=process.env.FUNDED_COMMUNITY_SNAPSHOT_ARCHIVE_DIR;
  t.after(()=>{if(previous===undefined)delete process.env.FUNDED_COMMUNITY_SNAPSHOT_ARCHIVE_DIR;else process.env.FUNDED_COMMUNITY_SNAPSHOT_ARCHIVE_DIR=previous;});
  process.env.FUNDED_COMMUNITY_SNAPSHOT_ARCHIVE_DIR=f.directory;
  const record=await f.service({snapshotArchive:undefined}).prepare(f.input);assert.ok(record.snapshotEvidence.sha256);
  assert.equal((await readdir(f.directory)).filter(n=>n.endsWith('.json')).length,1);
});

test('signed v0 migration with loaded addresses survives canonical serialization and offline replay',async t=>{
  const f=await communityArchiveFixture(t);f.useV0();const record=await f.service().prepare(f.input);
  const bytes=await readFile(join(f.directory,record.snapshotEvidence.sha256+'.json'),'utf8'),payload=JSON.parse(bytes);
  assert.ok(payload.evidence.migrationTransaction.meta.loadedAddresses.readonly.length>0);
  assert.equal(record.migrationSignature,f.migrationSignature);assert.deepEqual(await f.reopen().prepared(f.launch),record);
});

test('captured migration status must be finalized successful and match the exact transaction slot',async t=>{
  const f=await communityArchiveFixture(t),record=await f.service().prepare(f.input),original=await readFile(join(f.directory,record.snapshotEvidence.sha256+'.json'),'utf8');
  for(const mutate of [p=>{p.evidence.migrationStatus.value[0].confirmationStatus='confirmed';},p=>{p.evidence.migrationStatus.value[0].slot++;},
    p=>{p.evidence.migrationStatus.context.slot=999;},p=>{p.evidence.migrationStatus.value[0].err={failed:true};}]){
    const payload=JSON.parse(original);mutate(payload);assert.throws(()=>verifyCommunitySnapshotArchive(payload),/finalized status/);
  }
});

test('capture callback flushes evidence before a later preparation interruption',async t=>{
  const f=await communityArchiveFixture(t);
  await assert.rejects(f.service({captureSnapshot:async args=>{
    await captureExactCommunitySnapshot(args);assert.equal((await readdir(f.directory)).filter(n=>n.endsWith('.json')).length,1);
    throw Error('interrupted after durable capture');
  }}).prepare(f.input),/interrupted after durable capture/);
  assert.equal((await readdir(f.directory)).filter(n=>n.endsWith('.json')).length,1);assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});

test('changed returned snapshot cannot overwrite the already captured bank intent',async t=>{
  const f=await communityArchiveFixture(t);
  await assert.rejects(f.service({captureSnapshot:async args=>{const s=await captureExactCommunitySnapshot(args);s.accounts[0].balance='99';return s;}}).prepare(f.input),/differs from durably captured/);
  assert.equal((await f.store.read()).communityDrops?.[String(f.launch)],undefined);
});
