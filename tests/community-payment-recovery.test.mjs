import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PublicKey,TransactionMessage} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {communityLeaf} from '../community-merkle.js';
import {allocationAuditHash} from '../server/allocation-audit-hash.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {createCommunityAutoDelivery} from '../server/community-auto-delivery.mjs';
import {buildCommunityClaimInstruction,communityAddresses} from '../server/community-claim-chain.mjs';

const address=byte=>new PublicKey(new Uint8Array(32).fill(byte));
const authority={publicKey:address(1)},mint=address(2).toBase58(),programId=address(3).toBase58();
const blockhash=address(4).toBase58(),recipient=address(5).toBase58(),signature='s'.repeat(88);
const approvedHash='a'.repeat(64),deadline=1_800_000_300,executionKey=`community:${mint}:${recipient}`;
const leaf={recipient,index:0,amount:'100',proof:[]};

function fixture(t,{eligibility='claimed',receipt='success',visible=true,valid=false,legacy=false,existing=true,
  now=()=>deadline*1000,remoteSign}={}){
  const issuer=authority.publicKey.toBase58();
  const drop=communityAddresses({programId,authority:issuer,mint}).drop.toBase58();
  const manifest={drop,root:communityLeaf({drop,...leaf}).toString('hex'),snapshotHash:'b'.repeat(64),
    expiresAt:deadline,leaves:[leaf]};
  const record={programId,mint,authority:issuer,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),snapshotBasis:'pump-migration',
    automaticDeliveryVersion:2,manifest};
  const intent={cluster:'devnet',approvedHash,programId,authority:issuer,mint,root:manifest.root,
    snapshotHash:manifest.snapshotHash,action:recipient};
  const row={key:executionKey,intent,intentHash:allocationAuditHash(intent),signature,blockhash,lastValidBlockHeight:1000,
    ...(legacy?{status:'finalized',reconciledBy:'chain-status'}:{status:'verification-pending',signedTransaction:'saved-bytes'})};
  const state={communityExecutions:existing?{[executionKey]:row}:{}};
  const store={read:async()=>structuredClone(state),update:async update=>update(state)};
  const built=buildCommunityClaimInstruction({programId,authority:issuer,mint,tokenProgram:TOKEN_PROGRAM_ID,
    manifest,recipient,payer:authority.publicKey,allowProgramRecipient:true});
  const message=new TransactionMessage({payerKey:authority.publicKey,recentBlockhash:blockhash,
    instructions:[built.instruction]}).compileToV0Message();
  const indexOf=key=>message.staticAccountKeys.findIndex(value=>value.toBase58()===key);
  const balance=(account,owner,amount)=>({accountIndex:indexOf(account),owner,mint,programId:TOKEN_PROGRAM_ID.toBase58(),
    uiTokenAmount:{amount:String(amount)}});
  const payment=Buffer.alloc(92);
  createHash('sha256').update('account:CommunityPayment').digest().copy(payment,0,0,8);
  new PublicKey(drop).toBuffer().copy(payment,8);
  new PublicKey(recipient).toBuffer().copy(payment,40);
  payment.writeBigUInt64LE(100n,72);
  const transaction={transaction:{message,signatures:[signature]},meta:{err:receipt==='failed'?{InstructionError:[0,1]}:null,
    preBalances:Array(message.staticAccountKeys.length).fill(0),preTokenBalances:[balance(built.vaultToken,drop,1000)],
    postTokenBalances:[balance(built.vaultToken,drop,900),balance(built.recipientToken,recipient,receipt==='wrong-delta'?99:100)]}};
  const connection={
    getGenesisHash:async()=>DEVNET_GENESIS_HASH,
    getTransaction:t.mock.fn(async()=>receipt==='missing'?null:transaction),
    getAccountInfo:async()=>({owner:new PublicKey(programId),data:payment}),
    getSignatureStatuses:async()=>({value:[visible?{confirmationStatus:'finalized',err:transaction.meta.err}:null]}),
    isBlockhashValid:async()=>({value:valid}),getBlockHeight:async()=>1151,
    getLatestBlockhash:async()=>assert.fail('Recovery prepared a transaction'),
    sendRawTransaction:t.mock.fn(async()=>assert.fail('Recovery attempted a broadcast')),
  };
  const service={recipientProof:async()=>({status:eligibility,payment:built.payment})};
  const restart=()=>createCommunityAutoDelivery({connection,store,service,authority:{...authority,remoteSign},programId,approvedHash,now});
  return {connection,record,state,restart};
}

test('a paid recipient reconciles its saved attempt with exact receipt and balances',async t=>{
  const f=fixture(t);
  assert.equal((await f.restart().pay(f.record,leaf)).status,'finalized');
  const row=f.state.communityExecutions[executionKey];
  assert.equal(row.proof.balanceDeltaVerified,true);
  assert.equal(row.proof.amount,'100');
  assert.equal(row.signedTransaction,undefined);
  assert.equal((await f.restart().pay(f.record,leaf)).status,'already-paid');
  assert.equal(f.connection.getTransaction.mock.callCount(),1);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('finalized signature status alone leaves a paid recipient attempt pending',async t=>{
  const f=fixture(t,{receipt:'missing'}),before=structuredClone(f.state);
  assert.equal((await f.restart().pay(f.record,leaf)).status,'reconciliation-pending');
  assert.deepEqual(f.state,before);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('recipient receipt with an incorrect token delta cannot reconcile',async t=>{
  const f=fixture(t,{receipt:'wrong-delta'}),before=structuredClone(f.state);
  await assert.rejects(f.restart().pay(f.record,leaf),/99n !== 100n/);
  assert.deepEqual(f.state,before);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('a legacy status-only finalized row receives transaction proof on restart',async t=>{
  const f=fixture(t,{legacy:true});
  assert.equal((await f.restart().pay(f.record,leaf)).status,'finalized');
  assert.equal(f.state.communityExecutions[executionKey].proof.balanceDeltaVerified,true);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('an expired unpaid leaf retires a proven unlanded attempt without sending',async t=>{
  const f=fixture(t,{eligibility:'expired',receipt:'missing',visible:false});
  assert.equal((await f.restart().pay(f.record,leaf)).status,'expired-unlanded');
  const row=f.state.communityExecutions[executionKey];
  assert.equal(row.expiredAttempts[0].signature,signature);
  assert.equal(row.signature,undefined);
  assert.equal((await f.restart().pay(f.record,leaf)).status,'expired');
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('an expired unpaid leaf classifies a failed finalized attempt without sending',async t=>{
  const f=fixture(t,{eligibility:'expired',receipt:'failed'});
  assert.equal((await f.restart().pay(f.record,leaf)).status,'failed-finalized');
  assert.equal(f.state.communityExecutions[executionKey].proof,undefined);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('an expired unpaid leaf preserves an uncertain attempt without rebroadcast',async t=>{
  const f=fixture(t,{eligibility:'expired',receipt:'missing',visible:false,valid:true}),before=structuredClone(f.state);
  assert.equal((await f.restart().pay(f.record,leaf)).status,'reconciliation-pending');
  assert.deepEqual(f.state,before);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('a paid leaf without a journal remains already paid without transaction lookup',async t=>{
  const f=fixture(t,{existing:false});
  assert.equal((await f.restart().pay(f.record,leaf)).status,'already-paid');
  assert.deepEqual(f.state.communityExecutions,{});
  assert.equal(f.connection.getTransaction.mock.callCount(),0);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('a stale claimable result cannot start a new attempt once the manifest expires',async t=>{
  const f=fixture(t,{eligibility:'claimable',existing:false});
  assert.equal((await f.restart().pay(f.record,leaf)).status,'expired');
  assert.deepEqual(f.state.communityExecutions,{});
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('expiry while quoting prevents a fresh attempt from reaching the signer',async t=>{
  let clock=deadline*1000-1;
  const remoteSign=t.mock.fn(async()=>assert.fail('Expired attempt called the signer'));
  const f=fixture(t,{eligibility:'claimable',existing:false,now:()=>clock,remoteSign,valid:true});
  f.connection.getLatestBlockhash=async()=>({blockhash,lastValidBlockHeight:1000});
  f.connection.getMinimumBalanceForRentExemption=async()=>10;
  f.connection.getBalance=async()=>3_100_000_000;
  f.connection.getFeeForMessage=async()=>{
    clock=deadline*1000;
    return {value:5000};
  };
  assert.equal((await f.restart().pay(f.record,leaf)).status,'expired');
  assert.equal(remoteSign.mock.callCount(),0);
  assert.equal(f.state.communityExecutions[executionKey].signature,undefined);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});

test('expiry during blockhash verification prevents rebroadcasting saved bytes',async t=>{
  let clock=deadline*1000-1;
  const f=fixture(t,{eligibility:'claimable',receipt:'missing',visible:false,now:()=>clock});
  f.connection.isBlockhashValid=async()=>{
    clock=deadline*1000;
    return {value:true};
  };
  const before=structuredClone(f.state);
  assert.equal((await f.restart().pay(f.record,leaf)).status,'reconciliation-pending');
  assert.deepEqual(f.state,before);
  assert.equal(f.connection.sendRawTransaction.mock.callCount(),0);
});
