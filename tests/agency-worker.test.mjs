import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {agencyWorkerConfig,runAgencyCycle,agencyWorkerBlocked} from '../scripts/run-agency-worker.mjs';
import {agencyWorkerHealth} from '../server/agency-deployment.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)),authority=key(231),programId=key(232).publicKey.toBase58(),mint=key(233).publicKey.toBase58(),lookupAddress=key(234).publicKey.toBase58();
const env={SOLANA_CLUSTER:'devnet',DATABASE_URL:'postgresql://fixture.invalid/qa',X_POST_EXPECTED_HANDLE:'fundedvip',X_POST_ACCOUNT_ID:'123',
  X_POST_PUBLIC_ORIGIN:'https://funded.vip',X_POST_START_AT:'2026-10-01T00:00:00Z',X_POST_ENABLED:'true',X_POST_ALLOW_DEVNET:'true',X_POST_ACCESS_TOKEN:'synthetic',X_POST_ACCOUNT_STATUS:'active',
  FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),FUNDED_BUILD_ID:'b'.repeat(40),
  FUNDED_V3_BUYBACK_LOOKUP_TABLE:lookupAddress,FUNDED_V3_AGENCY_ENABLED:'true'};
function fixture(execute){
  let writes=0,promotions=0,buys=0,posts=0,state={launches:{[mint]:{mint,cluster:'devnet',pumpFeeRoute:{programId,protocolSplit:{agencyPercent:10}}}}};
  const config=agencyWorkerConfig(env,execute?['--once','--execute']:['--once']);
  const input={config,store:{read:async()=>structuredClone(state),update:async fn=>{writes++;return fn(state);}},
    outbox:{},connection:{getAddressLookupTable:async()=>({value:{key:new PublicKey(lookupAddress),state:{deactivationSlot:0xffffffffffffffffn}}})},authority,
    publisher:{verifyAccount:async()=>({id:'123'}),publish:async()=>{throw new Error('Unexpected public request');}},
    readDeployment:async()=>({revision:'1'}),readContext:async()=>({policy:{selectedMask:7,completedMask:0,paidLamports:[0n,0n,0n,0n,0n,0n,0n,100n],
      withdrawnLamports:[0n,0n,0n,0n,0n,0n,0n,0n]},remainingLamports:'100',agentRemaining:['33','33','34'],slot:123,policyFingerprint:'c'.repeat(64)}),
    promotion:async()=>{promotions++;return{status:'x-pending',mint};},milestone:async()=>{buys++;return{status:'below-threshold',mint};},
    dispatch:async args=>{assert.deepEqual(args.kinds,['agency_promotion']);posts++;return{posted:0};}};
  return{input,get state(){return state;},get counts(){return{writes,promotions,buys,posts};}};
}
test('agency dry run performs custody preview without financial journal, post dispatch or heartbeat activation',async()=>{
  const f=fixture(false),result=await runAgencyCycle(f.input);assert.equal(result.events[0].status,'dry-run');
  assert.deepEqual(f.counts,{writes:0,promotions:0,buys:0,posts:0});
});
test('dedicated worker verifies account, dispatches only agency events and distinguishes heartbeat readiness from execution success',async()=>{
  const f=fixture(true);await runAgencyCycle(f.input);assert.deepEqual(f.counts,{writes:1,promotions:2,buys:2,posts:1});
  const row=f.state.adminSettings.agencyWorker;assert.equal(row.status,'ready');assert.equal(row.pendingExecutions,2);
  const health={programId,approvedHash:'a'.repeat(64),authority:authority.publicKey.toBase58(),revision:'1',build:'b'.repeat(40)};
  assert.equal(agencyWorkerHealth(f.state,health),true);
  assert.equal(agencyWorkerHealth(f.state,{...health,build:'c'.repeat(40)}),false);
  assert.equal(agencyWorkerHealth(f.state,{...health,now:Date.parse(row.checkedAt)+90001}),false);
});
test('unexpected milestone failures degrade readiness; an incomplete migration remains explicitly pending',async()=>{
  const f=fixture(true);f.input.milestone=async({agent})=>{throw Object.assign(new Error('Unavailable'),{code:agent===1?'AGENCY_MARKET_NOT_MIGRATED':'RPC_UNAVAILABLE'});};
  const result=await runAgencyCycle(f.input);assert(result.events.some(row=>row.status==='awaiting-migration'));
  assert(result.events.some(row=>row.status==='execution-unavailable'));assert.equal(f.state.adminSettings.agencyWorker.status,'degraded');
});
test('worker requires explicit execution, correct network, pinned platform account and exact build',()=>{
  assert.equal(agencyWorkerConfig({...env,X_POST_INTERVAL_MS:'300000'},[]).intervalMs,60000,'Slower payout polling must not age agency readiness beyond 90 seconds.');
  assert.equal(agencyWorkerConfig(env,[]).minIntervalMs,21600000);
  for(const bad of [{FUNDED_V3_AGENCY_ENABLED:'false'},{SOLANA_CLUSTER:'mainnet-beta'},{X_POST_EXPECTED_HANDLE:'otheraccount'},
    {X_POST_ACCOUNT_ID:''},{FUNDED_BUILD_ID:'latest'}])assert.throws(()=>agencyWorkerConfig({...env,...bad},['--execute']));
  assert.throws(()=>agencyWorkerConfig(env,['--status','--execute']));
});
test('publisher failures retain actionable sanitized diagnostics and cannot satisfy worker readiness',()=>{
  const config=agencyWorkerConfig(env,['--execute']);
  const reasons={401:'x-auth-rejected',402:'x-credits-unavailable',403:'x-permission-denied',429:'x-rate-limited'};
  for(const [status,reasonCode]of Object.entries(reasons)){
    const failure=agencyWorkerBlocked(Object.assign(new Error('secret-token-and-rpc-url'),{status:Number(status)}),{config,authority,now:1792462679000});
    assert.equal(failure.reasonCode,reasonCode);assert.equal(failure.build,config.build);assert.equal(failure.approvedHash,config.approvedHash);
    assert.doesNotMatch(JSON.stringify(failure),/secret-token-and-rpc-url/);
    assert.equal(agencyWorkerHealth({adminSettings:{agencyWorker:failure}},{programId,approvedHash:config.approvedHash,authority:authority.publicKey.toBase58(),revision:'1',build:config.build,now:1792462679000}),false);
  }
});
test('unknown worker errors do not expose raw diagnostics or invent a provider rejection',()=>{
  const config=agencyWorkerConfig(env,[]),failure=agencyWorkerBlocked(new Error('private RPC URL and credential'),{config,authority});
  assert.equal(failure.reasonCode,'verification-unavailable');assert.equal(failure.status,'blocked');
  assert.doesNotMatch(JSON.stringify(failure),/private RPC URL and credential/);
  assert.equal(agencyWorkerBlocked({status:'constructor'},{config,authority}).reasonCode,'verification-unavailable');
});
