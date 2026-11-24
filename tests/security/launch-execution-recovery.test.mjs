import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair,SystemProgram,Transaction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {executeLaunchPlan} from '../../launch-executor.js';
import {JOURNAL_KEY,readLaunchJournal,recordLaunchEvent,journalRecovery} from '../../launch-journal.js';
import {createLaunchRecoveryRecorder} from '../../launch-recovery-outcome.js';
import {recoveryItems} from '../../src/features/experience/recovery-inbox.js';

// In-memory disposable wallets and mocked RPC only; no network or persisted keys.
function fixture(versioned=false,steps=1){
  const payer=Keypair.fromSeed(new Uint8Array(32).fill(71)),mint=Keypair.fromSeed(new Uint8Array(32).fill(72));
  const blockhash=Keypair.fromSeed(new Uint8Array(32).fill(73)).publicKey.toBase58();
  const instruction=SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,
    lamports:1,space:0,programId:SystemProgram.programId});
  const transaction=()=>versioned?new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,
    recentBlockhash:blockhash,instructions:[instruction]}).compileToV0Message()):new Transaction().add(instruction);
  const f={events:[],signs:0,sends:0,confirmations:0,statusReads:0,current:true};
  f.connection={getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:100}),
    sendRawTransaction:async(raw,options)=>{f.sends++;f.options=options;f.signature=bs58.encode(VersionedTransaction.deserialize(raw).signatures[0]);return f.signature;},
    confirmTransaction:async()=>{f.confirmations++;return {context:{slot:50},value:{err:null}};},
    getSignatureStatuses:async()=>{f.statusReads++;return {value:[{slot:50,confirmationStatus:'finalized',err:null}]};}};
  f.provider={signTransaction:async tx=>{f.signs++;if(tx instanceof VersionedTransaction)tx.sign([payer]);else tx.partialSign(payer);return tx;}};
  f.input={connection:f.connection,provider:f.provider,payer:payer.publicKey,mint,
    plan:{steps:Array.from({length:steps},(_,i)=>({kind:i?'launch':'initialize-mint-router',transaction:transaction()}))},
    onEvent:async event=>{f.events.push(event);},assertWalletCurrent:()=>{if(!f.current)throw Error('Wallet changed');}};
  f.run=extra=>executeLaunchPlan({...f.input,...extra});return f;
}
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('launch executor awaits approval and broadcast journals for legacy and v0 messages',async()=>{
  for(const versioned of [false,true]){
    const f=fixture(versioned),approval=gate(),broadcast=gate(),approvalEntered=gate(),broadcastEntered=gate();
    const pending=f.run({onEvent:async event=>{f.events.push(event);
      if(event.state==='awaiting-approval'){approvalEntered.resolve();await approval.promise;}
      if(event.state==='broadcasting'){broadcastEntered.resolve();await broadcast.promise;}}});
    await approvalEntered.promise;assert.equal(f.signs,0);assert.equal(f.sends,0);
    approval.resolve();await broadcastEntered.promise;assert.equal(f.signs,1);assert.equal(f.sends,0);
    broadcast.resolve();const result=await pending;
    assert.equal(result.mintRouterSignature,f.signature);assert.equal(f.sends,1);
    assert.deepEqual(f.options,{skipPreflight:false,maxRetries:0});
    assert.deepEqual(f.events.map(event=>event.state),['awaiting-approval','broadcasting','submitted','confirmed']);
  }
});

test('launch executor stops at asynchronous journal failures and preserves broadcast outcome',async()=>{
  for(const state of ['awaiting-approval','broadcasting','submitted','confirmed']){
    const f=fixture(true,2),afterSend=['submitted','confirmed'].includes(state);
    await assert.rejects(f.run({onEvent:async event=>{if(event.state===state)throw Error('Journal unavailable');f.events.push(event);}}),error=>{
      assert.match(error.message,/Journal unavailable/);assert.equal(error.launchRecovery.broadcastAttempted,afterSend);
      assert.equal(error.launchRecovery.outcome,state==='confirmed'?'finalized-success':afterSend?'unknown':'not-submitted');
      if(afterSend)assert.equal(error.launchRecovery.signature,f.signature);return true;
    });
    assert.equal(f.sends,afterSend?1:0);assert.equal(f.signs,state==='awaiting-approval'?0:1);
  }
});

test('launch executor preserves an unknown send when the recovery writer also fails',async()=>{
  const f=fixture(false,2);
  f.connection.sendRawTransaction=async()=>{f.sends++;throw Error('RPC result lost');};
  await assert.rejects(f.run({onEvent:async event=>{if(event.state==='unknown')throw Error('Secondary journal failure');}}),error=>{
    assert.equal(error.message,'RPC result lost');assert.equal(error.journalUnavailable,true);
    assert.equal(error.launchRecovery.outcome,'unknown');assert.equal(error.launchRecovery.broadcastAttempted,true);
    assert.equal(bs58.decode(error.launchRecovery.signature).length,64);return true;
  });
  assert.equal(f.sends,1);assert.equal(f.signs,1);assert.equal(f.confirmations,0);
});

test('launch executor requires explicit finalized success and never resends during reconciliation',async()=>{
  for(const response of [null,{}, {value:{}},{value:{err:false}},{value:{err:true}}]){
    const f=fixture();f.connection.confirmTransaction=async()=>response;
    await assert.rejects(f.run(),error=>error.launchRecovery.outcome==='unknown');
    assert(!f.events.some(event=>event.state==='confirmed'));assert.equal(f.sends,1);
  }
  const f=fixture();f.connection.confirmTransaction=async()=>{throw Error('Confirmation timed out');};
  assert.equal((await f.run()).mintRouterSignature,f.signature);assert.equal(f.sends,1);assert.equal(f.statusReads,1);
  const incomplete=fixture();incomplete.connection.confirmTransaction=async()=>{throw Error('Expired');};
  incomplete.connection.getSignatureStatuses=async()=>({value:[{confirmationStatus:'finalized'}]});
  await assert.rejects(incomplete.run(),error=>error.launchRecovery.outcome==='unknown');assert.equal(incomplete.sends,1);
  const failed=fixture(false,2);failed.connection.confirmTransaction=async()=>({value:{err:{InstructionError:[0,'Custom']}}});
  await assert.rejects(failed.run(),error=>error.knownFailure&&error.launchRecovery.outcome==='finalized-failure');
  assert.equal(failed.sends,1);assert.equal(failed.events.at(-1).state,'failed');
});

test('launch executor rechecks wallet and quote after persistence and rejects malformed expiry',async()=>{
  for(const mode of ['wallet','quote']){
    const f=fixture();let expired=false;
    await assert.rejects(f.run({onEvent:async event=>{if(event.state==='broadcasting'){
      if(mode==='wallet')f.current=false;else expired=true;}},beforeBroadcast:()=>{if(expired)throw Error('Quote expired');}}),
    error=>error.launchRecovery.broadcastAttempted===false);
    assert.equal(f.sends,0);
  }
  const f=fixture();f.connection.getLatestBlockhash=async()=>({blockhash:SystemProgram.programId.toBase58()});
  await assert.rejects(f.run(),/valid finalized launch blockhash/);assert.equal(f.signs,0);assert.equal(f.sends,0);
});

test('launch executor rejects wallet message substitution in both wire formats',async()=>{
  for(const versioned of [false,true]){
    const f=fixture(versioned),original=f.provider.signTransaction;
    f.provider.signTransaction=async tx=>{const signed=await original(tx);
      if(versioned)signed.message.recentBlockhash=SystemProgram.programId.toBase58();else signed.recentBlockhash=SystemProgram.programId.toBase58();
      return {serialize:()=>signed.serialize({requireAllSignatures:false,verifySignatures:false})};};
    await assert.rejects(f.run(),/Wallet changed/);assert.equal(f.sends,0);
  }
});

function storage(initial='[]'){
  const f={text:initial,writes:0};f.getItem=()=>f.text;f.setItem=(_key,text)=>{f.writes++;f.text=text;};return f;
}
test('launch journal refuses corrupt or unreadable history and verifies its write',()=>{
  for(const value of ['broken','{}','[{"id":"old","state":"unknown"}]']){
    const s=storage(value);assert.throws(()=>recordLaunchEvent('new',{state:'prepared'},s),/could not be read/);
    assert.equal(s.text,value);assert.equal(s.writes,0);
  }
  const unreadable=storage();unreadable.getItem=()=>{throw Error('Storage unavailable');};
  assert.deepEqual(readLaunchJournal(unreadable),[]);
  assert.throws(()=>recordLaunchEvent('new',{state:'prepared'},unreadable),/could not be read/);assert.equal(unreadable.writes,0);
  const dropped=storage();dropped.setItem=()=>{};
  assert.throws(()=>recordLaunchEvent('new',{state:'prepared'},dropped),/could not be saved/);
});

test('launch journal retains unresolved receipts beyond row and event history limits',()=>{
  const s=storage();recordLaunchEvent('pending',{state:'broadcasting',signature:'original-receipt',step:'promotion-burn'},s);
  for(let i=0;i<75;i++)recordLaunchEvent('done-'+i,{state:'completed'},s);
  let pending=readLaunchJournal(s).find(row=>row.id==='pending');assert.equal(pending.signature,'original-receipt');
  for(let i=0;i<75;i++)recordLaunchEvent('pending',{state:'unknown',message:'Checking original receipt'},s);
  pending=readLaunchJournal(s).find(row=>row.id==='pending');
  assert(pending.events.some(event=>event.step==='promotion-burn'&&event.signature==='original-receipt'));
  assert.equal(JSON.parse(s.getItem(JOURNAL_KEY)).find(row=>row.id==='pending').signature,'original-receipt');
  assert(readLaunchJournal(s).filter(row=>row.state==='completed').length<=50);
});

test('launch recovery retains earlier finalized steps and unresolved developer buys after registration',async()=>{
  const recorder=createLaunchRecoveryRecorder();
  await recorder.record({state:'confirmed',step:'promotion-burn',signature:'burn-receipt'});
  const cancelled=Object.assign(Error('Launch cancelled'),{launchRecovery:{broadcastAttempted:false,outcome:'not-submitted'}});
  assert.equal(recorder.failure(cancelled).launchRecovery.signature,'burn-receipt');
  assert.equal(recorder.failure(Error('Receipt read failed')).launchRecovery.broadcastAttempted,true);
  const controller=createLaunchRecoveryRecorder();
  const flow=createLaunchRecoveryRecorder(controller.record);
  await flow.record({state:'confirmed',step:'launch',signature:'created-coin'});
  const afterReturn=controller.failure(Error('Registration storage unavailable'));
  assert.equal(afterReturn.launchRecovery.signature,'created-coin');
  assert.equal(afterReturn.launchRecovery.outcome,'finalized-success');
  const s=storage();recordLaunchEvent('coin',{state:'unknown',step:'developer-buy',signature:'pending-buy'},s);
  recordLaunchEvent('coin',{state:'completed'},s);
  for(let i=0;i<75;i++)recordLaunchEvent('other-'+i,{state:'completed'},s);
  const saved=readLaunchJournal(s).find(row=>row.id==='coin');assert(saved);
  assert.match(journalRecovery(saved),/pending-buy/);assert.match(journalRecovery(saved),/uncertain/);
  const payer=Keypair.generate().publicKey.toBase58();
  const inbox=recoveryItems(payer,[{...saved,payer,cluster:'devnet',signature:'launch-receipt'}],[]);
  assert.equal(inbox.length,1);assert.equal(inbox[0].signature,'pending-buy');assert.equal(inbox[0].state,'unknown');
  assert.equal(recoveryItems(Keypair.generate().publicKey.toBase58(),[{...saved,payer,cluster:'devnet'}],[]).length,0);
  recordLaunchEvent('coin',{state:'confirmed',step:'developer-buy',signature:'pending-buy'},s);
  recordLaunchEvent('coin',{state:'completed'},s);
  assert.match(journalRecovery(readLaunchJournal(s).find(row=>row.id==='coin')),/^Registered/);
  assert.equal(recoveryItems(payer,[{...readLaunchJournal(s).find(row=>row.id==='coin'),payer,cluster:'devnet'}],[]).length,0);
});
