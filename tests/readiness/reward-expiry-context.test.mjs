import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,Keypair,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {buildRewardManifest,SOL_ASSET_MINT} from '../../reward-merkle.js';
import {deriveRouterHeader} from '../../protocol-guard.js';
import {rewardAddresses,rewardReserveAddress,createAutomaticRewardChain} from '../../server/automatic-reward-chain.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {readRewardExpiryContext,verifyRewardExpiryTransition} from '../../server/reward-expiry-context.mjs';
import {sellReviewFixture} from './token-sell-review-fixture.mjs';

const key=n=>new PublicKey(new Uint8Array(32).fill(n));
const disc=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
function fixture(asset='SOL'){
  const f=sellReviewFixture(),program=f.expected.programId,mint=f.expected.mint,original=key(77),operator=f.expected.authority;
  const cycleId=Buffer.alloc(32,88).toString('hex'),manifest=buildRewardManifest({cycleId,asset,allocations:[{recipient:String(key(71)),amount:'300'}]});
  const {vault,cycle}=rewardAddresses({programId:program,authority:original,mint,cycleId}),assetKey=new PublicKey(asset==='SOL'?SOL_ASSET_MINT:asset);
  const reserve=rewardReserveAddress({programId:program,vault,asset}),router=deriveRouterHeader(program);
  f.plan={cluster:'mainnet-beta',cycle:String(cycle),mint:String(mint),asset,manifest,cutoffAt:100000,payoutAt:200000};
  const cycleBytes=Buffer.alloc(174);disc('RewardCycle').copy(cycleBytes);vault.toBuffer().copy(cycleBytes,8);Buffer.from(cycleId,'hex').copy(cycleBytes,40);
  Buffer.from(manifest.root,'hex').copy(cycleBytes,72);assetKey.toBuffer().copy(cycleBytes,104);cycleBytes.writeBigUInt64LE(300n,136);cycleBytes.writeBigUInt64LE(100n,144);
  cycleBytes.writeBigInt64LE(100000n,152);cycleBytes.writeBigInt64LE(200000n,160);cycleBytes.writeUInt32LE(1,168);
  cycleBytes[172]=PublicKey.findProgramAddressSync([Buffer.from('reward-cycle-v1'),vault.toBuffer(),Buffer.from(cycleId,'hex')],program)[1];cycleBytes[173]=1;
  const vaultBytes=Buffer.alloc(73);disc('RewardVault').copy(vaultBytes);original.toBuffer().copy(vaultBytes,8);mint.toBuffer().copy(vaultBytes,40);
  vaultBytes[72]=PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'),original.toBuffer(),mint.toBuffer()],program)[1];
  const reserveBytes=Buffer.alloc(81);disc('RewardReserve').copy(reserveBytes);vault.toBuffer().copy(reserveBytes,8);assetKey.toBuffer().copy(reserveBytes,40);reserveBytes.writeBigUInt64LE(241n,72);
  reserveBytes[80]=PublicKey.findProgramAddressSync([Buffer.from('reward-reserve-v1'),vault.toBuffer(),assetKey.toBuffer()],program)[1];
  const routerBytes=Buffer.alloc(131);Buffer.from('FUNDFEE1').copy(routerBytes);operator.toBuffer().copy(routerBytes,41);key(60).toBuffer().copy(routerBytes,74);
  f.rows=new Map([[String(cycle),cycleBytes],[String(vault),vaultBytes],[String(reserve),reserveBytes],[String(router),routerBytes]].map(([address,data])=>[address,{owner:program,executable:false,data,lamports:1000}]));
  f.original=original;f.operator=operator;f.program=program;f.vault=vault;f.cycle=cycle;f.reserve=reserve;f.router=router;
  f.time=200000+30*24*60*60;f.slot=f.market.slot;
  const contextual=f.connection.getAccountInfoAndContext;
  f.connection.getAccountInfoAndContext=async(address,options)=>f.rows.has(String(address))?{context:{slot:f.slot},value:f.rows.get(String(address))}:contextual(address,options);
  f.connection.getMultipleAccountsInfoAndContext=async addresses=>({context:{slot:f.slot},value:addresses.map(a=>f.rows.get(String(a))||null)});
  f.connection.getBlockTime=async()=>f.time;
  f.args=()=>({connection:f.connection,programId:program,currentAuthority:operator,plan:f.plan,cluster:'mainnet-beta',release:f.release});
  f.expire=()=>{f.rows.get(String(cycle)).data[173]=0;f.rows.get(String(reserve)).data.writeBigUInt64LE(41n,72);};
  return f;
}

for(const asset of ['SOL','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'])test('historical expiry authenticates original namespace and current signer for '+asset,async()=>{
  const f=fixture(asset),before=await readRewardExpiryContext(f.args()),ix=before.instruction;
  assert.equal(before.originalAuthority,String(f.original));assert.equal(ix.keys[0].pubkey.toBase58(),String(f.operator));
  assert.deepEqual(ix.keys.map(k=>[String(k.pubkey),k.isSigner,k.isWritable]),[[String(f.operator),true,false],[String(f.vault),false,false],
    [String(f.reserve),false,true],[String(f.cycle),false,true],[String(f.router),false,false]]);
  assert.notEqual(String(f.vault),String(rewardAddresses({programId:f.program,authority:f.operator,mint:f.plan.mint}).vault));
  f.expire();const after=await readRewardExpiryContext(f.args()),verified=verifyRewardExpiryTransition(before,after);
  assert.equal(verified.unpaidAmount,'200');assert.equal(after.liability.outstanding,'41');assert.equal(verified.liabilityDeltaVerified,true);
  assert.throws(()=>verifyRewardExpiryTransition(after,after));
});

test('missing saved cycle or unreviewed Mainnet release cannot select a fresh successor namespace',async()=>{
  const f=fixture();let calls=0;f.connection.getGenesisHash=async()=>{calls++;throw Error('No RPC allowed');};
  await assert.rejects(readRewardExpiryContext({...f.args(),release:null}));assert.equal(calls,0);
  f.plan.cycle=null;await assert.rejects(readRewardExpiryContext(f.args()));assert.equal(calls,0);
});

test('wrong genesis, plan network and changed reviewed program context reject historical expiry',async()=>{
  const f=fixture();f.connection.getGenesisHash=async()=> 'wrong';await assert.rejects(readRewardExpiryContext(f.args()));
  const g=fixture();g.plan.cluster='devnet';await assert.rejects(readRewardExpiryContext(g.args()));
  const h=fixture();h.programData.data[50]^=1;await assert.rejects(readRewardExpiryContext(h.args()));
});

test('changed immutable root, amount, time, asset and leaf count cannot authorize expiry',async()=>{
  for(const mutate of [f=>{f.plan.manifest.root='00'.repeat(32);},f=>{f.plan.manifest.totalAmount='301';},f=>{f.plan.cutoffAt++;},
    f=>{f.plan.payoutAt++;},f=>{f.plan.manifest.asset=String(key(90));},f=>{f.plan.manifest.leaves.push({...f.plan.manifest.leaves[0]});}]){
    const f=fixture();mutate(f);await assert.rejects(readRewardExpiryContext(f.args()));
  }
});

test('foreign or malformed original vault, cycle and reserve cannot be relabeled as historical state',async()=>{
  for(const field of ['vault','cycle','reserve'])for(const mutate of [a=>{a.owner=key(90);},a=>{a.data[8]^=1;},a=>{a.data[field==='cycle'?172:a.data.length-1]^=1;}]){
    const f=fixture();mutate(f.rows.get(String(f[field])));await assert.rejects(readRewardExpiryContext(f.args()));
  }
  const f=fixture();f.plan.originalAuthority=String(key(90));await assert.rejects(readRewardExpiryContext(f.args()));
});

test('old operator, paused guard, premature grace and missing time cannot construct expiry',async()=>{
  const f=fixture();await assert.rejects(readRewardExpiryContext({...f.args(),currentAuthority:f.original}));
  const g=fixture();g.rows.get(String(g.router)).data[106]=1;await assert.rejects(readRewardExpiryContext(g.args()),/paused/);
  const h=fixture();h.time--;await assert.rejects(readRewardExpiryContext(h.args()),/grace/);
  const i=fixture();i.time=null;await assert.rejects(readRewardExpiryContext(i.args()),/time/);
});

test('stale reads, unknown cycle layout and invalid unpaid liabilities remain unresolved',async()=>{
  const f=fixture(),read=f.connection.getMultipleAccountsInfoAndContext;f.connection.getMultipleAccountsInfoAndContext=async(...args)=>({...await read(...args),context:{slot:f.slot-1}});
  await assert.rejects(readRewardExpiryContext(f.args()),/Stale/);
  const g=fixture();g.rows.get(String(g.cycle)).data=Buffer.alloc(173);await assert.rejects(readRewardExpiryContext(g.args()));
  for(const mutate of [f=>f.rows.get(String(f.cycle)).data.writeBigUInt64LE(301n,144),f=>f.rows.get(String(f.reserve)).data.writeBigUInt64LE(199n,72)]){
    const f=fixture();mutate(f);await assert.rejects(readRewardExpiryContext(f.args()));
  }
});

test('expiry verification rejects wrong release, changed custody, paid amount and unrelated reserve fields',async()=>{
  for(const mutate of [f=>f.rows.get(String(f.reserve)).data.writeBigUInt64LE(40n,72),f=>{f.rows.get(String(f.vault)).lamports++;},
    f=>f.rows.get(String(f.cycle)).data.writeBigUInt64LE(101n,144),f=>{f.rows.get(String(f.reserve)).lamports++;}]){
    const f=fixture(),before=await readRewardExpiryContext(f.args());f.expire();mutate(f);
    await assert.rejects(async()=>verifyRewardExpiryTransition(before,await readRewardExpiryContext(f.args())));
  }
});

test('mocked Devnet adapter expires the saved original cycle using the successor signature',async()=>{
  const f=fixture();f.plan.cluster='devnet';f.rows.get(String(f.router)).data=Buffer.from(f.rows.get(String(f.router)).data.subarray(0,74));
  const read=f.connection.getAccountInfo;
  f.connection.getAccountInfo=async(address,...options)=>f.rows.has(String(address))?f.rows.get(String(address)):read(address,...options);
  f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
  f.connection.getLatestBlockhash=async()=>({blockhash:String(key(91)),lastValidBlockHeight:999999});
  let submitted=0;
  f.connection.sendRawTransaction=async wire=>{
    const signed=Transaction.from(wire);assert.ok(signed.verifySignatures());assert.equal(String(signed.signatures[0].publicKey),String(f.operator));
    assert.equal(String(signed.instructions[0].keys[1].pubkey),String(f.vault));assert.equal(String(signed.instructions[0].keys[3].pubkey),String(f.cycle));
    submitted++;f.expire();return bs58.encode(signed.signature);
  };
  f.connection.getSignatureStatuses=async()=>({context:{slot:f.slot},value:[{slot:f.slot,err:null,confirmationStatus:'finalized'}]});
  const chain=createAutomaticRewardChain({connection:f.connection,programId:f.program,authority:Keypair.fromSeed(new Uint8Array(32).fill(33)),
    cluster:'devnet',expectedProgramDataSha256:f.release.programDataSha256});
  const result=await chain.expireCycle(f.plan);assert.equal(result.unpaidAmount,'200');assert.equal(submitted,1);
  assert.equal((await chain.expireCycle(f.plan)).alreadyExpired,true);assert.equal(submitted,1);
});
