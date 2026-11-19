import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {executeAgencyJournal} from '../server/agency-execution-journal.mjs';
import {runAgencyMilestone} from '../server/agency-buyback-executor.mjs';
import {recordAgencyPreparationFailure} from '../server/agency-preparation-retry.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {readAgencyBuybackReadiness} from '../server/agency-buyback-readiness.mjs';
import {readFileSync} from 'node:fs';
import {loadPriceSignerRuntime} from '../server/price-signer-bootstrap.mjs';

function fixture(){
  const authority=Keypair.generate(),mint=String(Keypair.generate().publicKey),key='agency:'+mint+':1:0';
  const intent={cluster:'devnet',approvedHash:'a'.repeat(64),mint,agent:1};
  const state={},store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
  let time=1000,preparations=0,authorizations=0,balance=4000000000;
  const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getFeeForMessage:async()=>({value:5000}),
    getBalance:async()=>balance,isBlockhashValid:async()=>({value:true}),
    sendRawTransaction:async()=>{assert(state.v3AgencyExecutions[key].signedTransaction);throw Error('send timeout');},
    getSignatureStatuses:async()=>({value:[null]})};
  const prepare=async()=>{
    preparations++;
    const transaction=new VersionedTransaction(new TransactionMessage({payerKey:authority.publicKey,
      recentBlockhash:String(Keypair.generate().publicKey),instructions:[SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message());
    return {transaction,lastValidBlockHeight:100,estimatedRentLamports:'10000',authorize:async()=>{authorizations++;}};
  };
  const run=extra=>executeAgencyJournal({store,connection,key,intent,authority,prepare,prove:async()=>null,now:()=>time,...extra});
  return {state,store,key,intent,mint,authority,connection,run,prepare,time:value=>{time=value;},balance:value=>{balance=value;},
    counts:()=>({preparations,authorizations})};
}
test('failed preparation clears preparing, sanitizes reason and backs off across retries',async()=>{
  const f=fixture(),error=Object.assign(Error('https://secret.invalid?token=private'),{code:'AGENCY_PRICE_SIGNER_DECLINED'});
  await assert.rejects(f.run({prepare:async()=>{throw error;}}));
  const row=f.state.v3AgencyExecutions[f.key];
  assert.equal(row.status,'preparation-failed');assert.equal(row.leaseUntil,0);assert.equal(row.nextAttemptAt,121000);
  assert.equal(row.reasonCode,'price-signer-declined');assert(!JSON.stringify(row).includes('private'));
  assert.equal((await f.run()).status,'preparation-retry-wait');assert.deepEqual(f.counts(),{preparations:0,authorizations:0});
  f.time(121000);await assert.rejects(f.run({prepare:async()=>{throw error;}}));
  assert.equal(row.preparationFailures,1); // Prior snapshot remains unchanged when a new attempt acquires ownership.
  assert.equal(f.state.v3AgencyExecutions[f.key].nextAttemptAt,361000);
  f.time(361000);assert.equal((await f.run()).status,'verification-pending');
  assert.equal((await f.run()).status,'verification-pending');assert.deepEqual(f.counts(),{preparations:1,authorizations:1});
});
test('payer reserve and lost lease reject before price authorization',async()=>{
  const f=fixture();f.balance(3000000000);
  await assert.rejects(f.run(),/reserve/);assert.equal(f.counts().authorizations,0);
  const g=fixture();await assert.rejects(g.run({prepare:async()=>{const built=await g.prepare();g.time(200000);return built;}}),/lease expired/);
  assert.equal(g.counts().authorizations,0);assert.equal(g.state.v3AgencyExecutions[g.key].reasonCode,'preparation-expired');
});
test('a stale owner cannot overwrite a successor or a saved signed transaction',async()=>{
  const f=fixture();await f.run();const row=f.state.v3AgencyExecutions[f.key];
  await recordAgencyPreparationFailure({store:f.store,key:f.key,token:row.token,error:Error('failure'),now:1000});
  assert.equal(row.status,'verification-pending');
  delete row.signature;row.token='new-owner';
  await recordAgencyPreparationFailure({store:f.store,key:f.key,token:'old-owner',error:Error('failure'),now:1000});
  assert.equal(row.status,'verification-pending');
});
test('milestone skips market and custody reads during persisted backoff',async()=>{
  const f=fixture();f.state.v3AgencyExecutions={[f.key]:{key:f.key,nextAttemptAt:5000,reasonCode:'price-signer-declined'}};
  const result=await runAgencyMilestone({store:f.store,connection:f.connection,mint:f.mint,agent:1,authority:f.authority,now:()=>1000,
    priceService:null,readContext:async()=>{throw Error('unexpected custody read');}});
  assert.equal(result.status,'preparation-retry-wait');assert.equal(result.nextAttemptAt,5000);
});
test('expired unsigned preparing status is recovered even if subsequent custody is unavailable',async()=>{
  const f=fixture();f.state.v3AgencyExecutions={[f.key]:{key:f.key,status:'preparing',leaseUntil:500,token:'old'}};
  await assert.rejects(runAgencyMilestone({store:f.store,connection:f.connection,mint:f.mint,agent:1,authority:f.authority,now:()=>1000,
    priceService:null,readContext:async()=>{throw Error('custody unavailable');}}));
  assert.equal(f.state.v3AgencyExecutions[f.key].status,'preparation-interrupted');
});
test('Mainnet review worksheet cannot activate signer or readiness',async()=>{
  const config=JSON.parse(readFileSync(new URL('../config/mainnet-price-signer-review.json',import.meta.url),'utf8'));
  assert.equal(config.activationBlocked,true);
  await assert.rejects(loadPriceSignerRuntime({env:{PRICE_SIGNER_CONFIG_FILE:'config'},read:()=>JSON.stringify(config),
    connectionFactory:()=>{throw Error('must not access RPC');}}),/Mainnet price signing is disabled/);
  const result=await readAgencyBuybackReadiness({env:{SOLANA_CLUSTER:'mainnet-beta',FUNDED_V3_AGENCY_BUYBACK_ENABLED:'true'},
    connection:new Proxy({},{get(){throw Error('must not access RPC');}})});
  assert.equal(result.ready,false);assert.match(result.reason,/separately reviewed/);
});
