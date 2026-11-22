import assert from 'node:assert/strict';
import test from 'node:test';
import {PublicKey} from '@solana/web3.js';
import {allocationAuditHash} from '../server/allocation-audit-hash.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {createCommunityAutoDelivery} from '../server/community-auto-delivery.mjs';
import {createCommunityDeliveryRuntime} from '../server/community-delivery-runtime.mjs';

const address=byte=>new PublicKey(new Uint8Array(32).fill(byte));
const authority={publicKey:address(1)};
const mint=address(2).toBase58(),programId=address(3).toBase58();
const approvedHash='a'.repeat(64),signature='s'.repeat(88),blockhash=address(4).toBase58();
const migrationAt=1_800_000_000,expiresAt=migrationAt+300;
const executionKey=`community:${mint}:open`;

function fixture(t,{outcome='finalized',alreadyRecorded=false,ignoreProof=false}={}){
  const manifest={root:'fixture-root',snapshotHash:'fixture-snapshot',expiresAt};
  const record={mint,programId,authority:authority.publicKey.toBase58(),snapshotBasis:'pump-migration',
    manifest,openingSignature:alreadyRecorded?signature:null};
  const intent={cluster:'devnet',approvedHash,programId,authority:record.authority,mint,
    root:manifest.root,snapshotHash:manifest.snapshotHash,action:'open'};
  const state={communityExecutions:{[executionKey]:{key:executionKey,intent,intentHash:allocationAuditHash(intent),
    status:'verification-pending',signature,blockhash,lastValidBlockHeight:1000,signedTransaction:'saved-bytes'}}};
  const store={read:async()=>structuredClone(state),update:async update=>update(state)};
  const receipt={blockTime:migrationAt+299,meta:{err:null}};
  const connection={
    getGenesisHash:async()=>DEVNET_GENESIS_HASH,
    getTransaction:t.mock.fn(async()=>outcome==='finalized'?receipt:null),
    getSignatureStatuses:async()=>({value:[outcome==='unlanded'||outcome==='uncertain'?null:{confirmationStatus:'finalized',err:null}]}),
    isBlockhashValid:async()=>({value:outcome==='uncertain'}),
    getBlockHeight:async()=>1151,
    sendRawTransaction:t.mock.fn(async()=>assert.fail('Expired opening attempted a broadcast')),
  };
  const service={
    recordOpening:t.mock.fn(async input=>{
      assert.deepEqual(input,{mint,signature});
      assert.ok(receipt.blockTime<expiresAt);
      record.openingSignature=signature;
    }),
    approvalInstruction:async()=>assert.fail('Expired opening prepared approval'),
    openingInstruction:async()=>assert.fail('Expired opening prepared a transaction'),
  };
  if(ignoreProof)service.recordOpening=async()=>assert.fail('Signature status is not an opening receipt');
  const restart=()=>createCommunityAutoDelivery({connection,store,service,authority,programId,approvedHash,
    now:()=>expiresAt*1000});
  return {record,state,service,connection,restart};
}

test('recovers a finalized opening saved before the 300-second deadline after worker restart',async t=>{
  const {record,state,service,connection,restart}=fixture(t);
  assert.equal(record.openingSignature,null);
  assert.equal((await restart().open(record)).status,'finalized');
  assert.equal(record.openingSignature,signature);
  assert.deepEqual(state.communityExecutions[executionKey].proof,{signature,finalized:true,balanceDeltaVerified:true});
  assert.equal(state.communityExecutions[executionKey].signedTransaction,undefined);
  assert.equal((await restart().open(record)).status,'opened');
  assert.equal(service.recordOpening.mock.callCount(),1);
  assert.equal(connection.sendRawTransaction.mock.callCount(),0);
});

test('retires an expired unlanded opening without creating another attempt',async t=>{
  const {record,state,connection,restart}=fixture(t,{outcome:'unlanded'});
  assert.equal((await restart().open(record)).status,'expired');
  const saved=state.communityExecutions[executionKey];
  assert.equal(saved.status,'expired-unlanded');
  assert.equal(saved.signature,undefined);
  assert.equal(saved.expiredAttempts[0].signature,signature);
  assert.equal((await restart().open(record)).status,'expired');
  assert.equal(connection.getTransaction.mock.callCount(),2);
  assert.equal(connection.sendRawTransaction.mock.callCount(),0);
});

test('keeps an uncertain opening untouched after the deadline while the blockhash remains valid',async t=>{
  const {record,state,connection,restart}=fixture(t,{outcome:'uncertain'});
  const before=structuredClone(state);
  assert.equal((await restart().open(record)).status,'expired');
  assert.deepEqual(state,before);
  assert.equal(connection.getTransaction.mock.callCount(),1);
  assert.equal(connection.sendRawTransaction.mock.callCount(),0);
});

test('keeps a journal pending when a saved opening has status but lacks its receipt',async t=>{
  const {record,state,restart}=fixture(t,{outcome:'missing-receipt',alreadyRecorded:true,ignoreProof:true});
  const before=structuredClone(state);
  assert.equal((await restart().open(record)).status,'opened');
  assert.deepEqual(state,before);
});

test('a recovered opening lets the restarted worker visit all 28 leaves without paying after expiry',async t=>{
  const {record,state,service,connection}=fixture(t);
  const leaves=Array.from({length:28},(_,index)=>({index,recipient:address(index+10).toBase58(),amount:'100'}));
  record.manifest.leaves=leaves;
  const rewardState={communityDrops:{[mint]:record}};
  const store={read:async()=>structuredClone(state),update:async update=>update(state)};
  const rewardStore={read:async()=>structuredClone(rewardState),transaction:async update=>update(rewardState)};
  state.launches={[mint]:{mint,cluster:'devnet',onchainVerified:true,communityAirdrop:{reservedTokens:2800},
    pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId,initialAuthority:record.authority}}};
  service.prepared=async()=>structuredClone(record);
  service.recipientProof=t.mock.fn(async({wallet})=>{
    const leaf=leaves.find(candidate=>candidate.recipient===wallet);
    return leaf.index<3?{status:'claimed',payment:address(leaf.index+60).toBase58()}:{status:'expired'};
  });

  const restart=()=>createCommunityDeliveryRuntime({store,automaticRewardStore:rewardStore,solanaCluster:'devnet',
    connection,serviceFactory:()=>service,v3AuthorityKeypair:()=>authority,now:()=>expiresAt*1000,
    env:{FUNDED_COMMUNITY_AUTO_DELIVERY_ENABLED:'true',FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
      FUNDED_V3_PROGRAM_DATA_SHA256:approvedHash},
    deliveryFactory:options=>createCommunityAutoDelivery({...options,now:()=>expiresAt*1000})});
  let worker=restart();
  for(const [cursor,paid,waiting] of [[8,3,5],[16,0,8],[24,0,8],[4,3,5]]){
    await worker.tick();
    const status=rewardState.communityDeliveryStatus;
    assert.deepEqual([status.examined,status.paid,status.waiting,status.submitted,status.failures],[8,paid,waiting,0,[]]);
    assert.equal(rewardState.communityDeliveryCursors[mint],cursor);
    worker=restart();
  }
  assert.deepEqual(service.recipientProof.mock.calls.map(call=>call.arguments[0].wallet),
    [...leaves,...leaves.slice(0,4)].map(leaf=>leaf.recipient));
  assert.equal(service.recordOpening.mock.callCount(),1);
  assert.equal(connection.sendRawTransaction.mock.callCount(),0);
});
