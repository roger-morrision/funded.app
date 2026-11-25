import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {compareProgramInterfaces} from '../../scripts/program-upgrade-compatibility.mjs';
import {assessProgramUpgrade, UPGRADE_LOADER, sha256} from '../../scripts/program-upgrade-plan.mjs';

const key = n => new PublicKey(new Uint8Array(32).fill(n));
const program = key(81), authority = key(82);
const programDataAddress = PublicKey.findProgramAddressSync([program.toBuffer()], UPGRADE_LOADER)[0];
const discriminator = n => [n,0,0,0,0,0,0,0];
const copy = value => structuredClone(value);
function idl() {
  return {address:program.toBase58(), metadata:{name:'fixture', version:'1.0.0', spec:'0.1.0'},
    instructions:[{name:'release', discriminator:discriminator(1),
      accounts:[{name:'vault', writable:true}, {name:'owner', signer:true}], args:[{name:'amount', type:'u64'}]}],
    accounts:[{name:'Lock', discriminator:discriminator(2)}],
    types:[{name:'Lock', type:{kind:'struct', fields:[{name:'unlock_at', type:'i64'},
      {name:'state', type:{defined:{name:'Status'}}}]}},
    {name:'Status', type:{kind:'enum', variants:[{name:'Locked'}, {name:'Released'}]}}],
    events:[{name:'Paid', discriminator:discriminator(3)}],
    errors:[{name:'Locked', code:6000, msg:'Still locked'}]};
}
function validIdl() {
  const value = idl();
  value.types.push({name:'Paid', type:{kind:'struct', fields:[{name:'amount', type:'u64'}]}});
  return value;
}
const elf = marker => { const bytes=Buffer.alloc(96, marker); bytes.set([0x7f,0x45,0x4c,0x46]); return bytes; };
function evidence(binary, {slot=100, capacity=128, signer=authority}={}) {
  const data = Buffer.alloc(45+capacity);
  data.writeUInt32LE(3); data.writeBigUInt64LE(BigInt(slot),4);
  data[12]=signer ? 1 : 0;
  if (signer) signer.toBuffer().copy(data,13);
  binary.copy(data,45);
  const account = {executable:true, owner:UPGRADE_LOADER,
    data:Buffer.concat([Buffer.from([2,0,0,0]), programDataAddress.toBuffer()]), lamports:1};
  return {account, programData:{executable:false, owner:UPGRADE_LOADER, data, lamports:1}};
}
function rpc(snapshot, {genesis=SOLANA_GENESIS.devnet, slot=200}={}) {
  return {getGenesisHash:async()=>genesis, getSlot:async commitment=>{assert.equal(commitment,'finalized');return 200;},
    getMultipleAccountsInfoAndContext:async(keys, options)=>{
    assert.deepEqual(keys.map(k=>k.toBase58()), [program.toBase58(),programDataAddress.toBase58()]);
    assert.deepEqual(options, {commitment:'finalized',minContextSlot:200});
    return {context:{slot}, value:[snapshot.account,snapshot.programData]};
  }};
}
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'funded-upgrade-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const before=elf(1), after=elf(2), snapshot=evidence(before);
  const release=async(name,binary,interfaceIdl)=>{
    const bytes=Buffer.from(JSON.stringify(interfaceIdl));
    await writeFile(join(root,`${name}.so`),binary); await writeFile(join(root,`${name}.json`),bytes);
    return {sourceRevision:(name==='before'?'a':'b').repeat(40),
      binary:{file:`${name}.so`,bytes:binary.length,sha256:sha256(binary)},
      idl:{file:`${name}.json`,sha256:sha256(bytes)}};
  };
  const plan={schemaVersion:1,cluster:'devnet',programId:program.toBase58(),upgradeAuthority:authority.toBase58(),upgradeable:true,
    baseline:{...await release('before',before,validIdl()),deploymentSlot:'100',programDataSha256:sha256(snapshot.programData.data)},
    candidate:await release('after',after,validIdl())};
  return {root,plan,before,after,snapshot,release};
}

test('upgrade interface accepts additions and documentation changes without weakening old layouts',()=>{
  const old=validIdl(), next=copy(old);
  next.metadata.version='2.0.0'; next.instructions[0].docs=['Updated explanation'];
  next.instructions.push({name:'new_action',discriminator:discriminator(4),accounts:[],args:[]});
  const report=compareProgramInterfaces(old,next);
  assert.equal(report.status,'compatible-interface'); assert.deepEqual(report.additions,['instructions.new_action']);
  assert.match(report.scope,/Raw account bytes/);
});

test('upgrade interface detects removed instructions changed signers seeds layouts and enum order',()=>{
  const mutations=[
    value=>{value.instructions[0].name='renamed';},
    value=>{value.instructions[0].accounts.reverse();},
    value=>{value.instructions[0].accounts[1].signer=false;},
    value=>{value.instructions[0].accounts[0].pda={seeds:[{kind:'const',value:[1]}]};},
    value=>{value.instructions[0].args[0].type='u32';},
    value=>{value.instructions[0].discriminator=discriminator(8);},
    value=>{value.types[0].type.fields.push({name:'extra',type:'u64'});},
    value=>{value.types[1].type.variants.reverse();},
    value=>{value.accounts[0].discriminator=discriminator(9);},
    value=>{value.errors[0].code=6001;},
    value=>{value.address=key(83).toBase58();},
  ];
  for(const mutate of mutations){const next=validIdl();mutate(next);
    assert.equal(compareProgramInterfaces(validIdl(),next).status,'migration-required');}
});

test('upgrade interface fails closed on incomplete unsupported and colliding IDLs',()=>{
  const mutations=[
    value=>{delete value.address;}, value=>{delete value.metadata.spec;},
    value=>{value.instructions=[];}, value=>{delete value.instructions[0].discriminator;},
    value=>{value.instructions.push(copy(value.instructions[0]));},
    value=>{value.instructions.push({...copy(value.instructions[0]),name:'collision'});},
    value=>{value.types=[];}, value=>{value.state={};},
    value=>{value.types[0].type.fields[1].type.defined.name='Missing';},
    value=>{value.errors.push({name:'Other',code:6000});},
  ];
  for(const mutate of mutations){const next=validIdl();mutate(next);
    assert.throws(()=>compareProgramInterfaces(validIdl(),next));}
});

test('upgrade planning stays local-only offline and verifies a pinned finalized baseline online',async t=>{
  const f=await fixture(t), options={artifactDir:f.root};
  const offline=await assessProgramUpgrade(f.plan,options);
  assert.equal(offline.status,'local-only'); assert.equal(offline.chain,null);
  assert.equal(offline.ready,false); assert.equal(offline.deploymentAuthorized,false);
  const online=await assessProgramUpgrade(f.plan,{...options,connection:rpc(f.snapshot)});
  assert.equal(online.status,'preflight-passed'); assert.equal(online.chain.finalizedSlot,200);
  assert.equal(online.ready,false); assert.equal(online.deploymentAuthorized,false);
});

test('upgrade preflight rejects wrong network authority loader linkage bytes capacity and stale baselines',async t=>{
  const f=await fixture(t);
  await assert.rejects(assessProgramUpgrade(f.plan,{artifactDir:f.root,connection:rpc(f.snapshot,{genesis:SOLANA_GENESIS['mainnet-beta']})}),/network/);
  await assert.rejects(assessProgramUpgrade(f.plan,{artifactDir:f.root,connection:rpc(f.snapshot,{slot:199})}),/context/);
  const snapshots=[
    evidence(f.before,{signer:null}), evidence(f.before,{signer:key(84)}), evidence(f.after),
    evidence(f.before,{slot:101}), evidence(f.before,{capacity:96}),
  ];
  const owner=evidence(f.before); owner.account.owner=key(85); snapshots.push(owner);
  const pointer=evidence(f.before); key(86).toBuffer().copy(pointer.account.data,4); snapshots.push(pointer);
  const dataOwner=evidence(f.before); dataOwner.programData.owner=key(85); snapshots.push(dataOwner);
  const malformed=evidence(f.before); malformed.programData.data[12]=2; snapshots.push(malformed);
  const missing=evidence(f.before); missing.programData=null; snapshots.push(missing);
  const trailer=evidence(f.before); trailer.programData.data[trailer.programData.data.length-1]=1; snapshots.push(trailer);
  for(const snapshot of snapshots){const result=await assessProgramUpgrade(f.plan,{artifactDir:f.root,connection:rpc(snapshot)});
    assert.equal(result.status,'blocked');}
  // Even a freshly pinned header hash cannot authorize another binary.
  const wrong=evidence(f.after), plan=copy(f.plan);plan.baseline.programDataSha256=sha256(wrong.programData.data);
  const result=await assessProgramUpgrade(plan,{artifactDir:f.root,connection:rpc(wrong)});
  assert.equal(result.chain.checks.executableMatches,false); assert.equal(result.status,'blocked');
  const larger=Buffer.concat([f.after,Buffer.alloc(64)]);
  plan.candidate=await f.release('larger',larger,validIdl());
  plan.baseline=f.plan.baseline;
  const capacity=await assessProgramUpgrade(plan,{artifactDir:f.root,connection:rpc(f.snapshot)});
  assert.equal(capacity.chain.additionalBytesRequired,32);assert.equal(capacity.chain.checks.sufficientCapacity,false);
});

test('upgrade postcheck requires candidate bytes retained authority and a later finalized deployment',async t=>{
  const f=await fixture(t), options={artifactDir:f.root,phase:'after'};
  const good=evidence(f.after,{slot:101});
  const result=await assessProgramUpgrade(f.plan,{...options,connection:rpc(good)});
  assert.equal(result.status,'post-upgrade-bytes-verified');
  assert.equal(result.chain.programDataSha256,sha256(good.programData.data));
  assert.equal(result.ready,false); assert.equal(result.deploymentAuthorized,false);
  for(const snapshot of [f.snapshot,evidence(f.after),evidence(f.after,{slot:200}),evidence(f.after,{slot:201}),evidence(f.after,{slot:101,signer:null})])
    assert.equal((await assessProgramUpgrade(f.plan,{...options,connection:rpc(snapshot)})).status,'blocked');
});

test('upgrade artifacts reject tampering identity mismatch path escape and breaking schemas',async t=>{
  const f=await fixture(t), options={artifactDir:f.root};
  await writeFile(join(f.root,'after.so'),elf(3));
  await assert.rejects(assessProgramUpgrade(f.plan,options),/hash/);
  await writeFile(join(f.root,'after.so'),f.after);
  const outside=await mkdtemp(join(tmpdir(),'funded-upgrade-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'escape.so'),f.after);
  const escaped=copy(f.plan);escaped.candidate.binary.file=join(outside,'escape.so');
  await assert.rejects(assessProgramUpgrade(escaped,options),/inside/);
  const wrong=validIdl();wrong.address=key(87).toBase58();
  const plan=copy(f.plan);plan.candidate=await f.release('wrong',f.after,wrong);
  await assert.rejects(assessProgramUpgrade(plan,options),/identity/);
  const changed=validIdl();changed.types[0].type.fields[0].type='u32';
  plan.candidate=await f.release('breaking',f.after,changed);
  assert.equal((await assessProgramUpgrade(plan,options)).status,'blocked');
  assert.equal((await assessProgramUpgrade(plan,{...options,connection:rpc(f.snapshot)})).status,'blocked');
  plan.upgradeable=false; await assert.rejects(assessProgramUpgrade(plan,options),/retained/);
});

test('upgrade CLI is read-only rejects deployment flags and preserves existing reports',async t=>{
  const f=await fixture(t), planPath=join(f.root,'plan.json'), output=join(f.root,'report.json');
  await writeFile(planPath,JSON.stringify(f.plan));
  const args=[resolve('scripts/check-program-upgrade.mjs'),'--plan',planPath,'--artifact-dir',f.root,'--output',output];
  const run=extra=>spawnSync(process.execPath,[...args,...extra],{encoding:'utf8'});
  const first=run([]);assert.equal(first.status,0,first.stderr);
  assert.equal(JSON.parse(first.stdout).status,'local-only');
  const saved=await readFile(output,'utf8');
  assert.equal(run([]).status,1);assert.equal(await readFile(output,'utf8'),saved);
  assert.equal(run(['--deploy']).status,1);
  assert.equal(run(['--phase','after','--phase','before']).status,1);
});
