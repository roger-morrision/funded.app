import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {Keypair} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {quoteAgencyBuyback} from '../server/agency-buyback-quote.mjs';
import {runAgencyMilestone} from '../server/agency-buyback-executor.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
test('own-coin quote uses only snapshot reserves and clips expenditure to the smaller budget or liquidity limit',async()=>{
  const mint=key(201),pool=key(202),vault=key(203),observation={verified:true,cluster:'devnet',commitment:'finalized',poolKey:pool,mintKey:mint,
    baseTokenProgram:TOKEN_PROGRAM_ID,baseReserve:'100000000',quoteReserve:'1000000000',virtualQuoteReserve:'0'};
  const state={poolKey:pool,pool:{baseMint:mint,quoteMint:NATIVE_MINT,virtualQuoteReserves:new BN(0)},baseTokenProgram:TOKEN_PROGRAM_ID,
    poolBaseAmount:new BN(observation.baseReserve),poolQuoteAmount:new BN(observation.quoteReserve),poolAccountInfo:{owner:PUMP_AMM_PROGRAM_ID}};
  const input={observation,vault,budgetLamports:'10000000',readSwap:async()=>state,
    quoteOutput:args=>{assert.equal(String(args.quote),'2500000');assert.equal(args.slippage,1);return{base:new BN(1234)};},
    buildBuy:async(_state,amount)=>{assert.equal(String(amount),'2500000');return[{programId:PUMP_AMM_PROGRAM_ID}];}};
  const result=await quoteAgencyBuyback(input);assert.equal(result.maxTotalDebit,'2500000');assert.equal(result.minBaseAmountOut,'1234');
  state.poolQuoteAmount=new BN('999999999');await assert.rejects(()=>quoteAgencyBuyback(input),/differs/);
  state.poolQuoteAmount=new BN('1000000000');state.pool.baseMint=key(204);await assert.rejects(()=>quoteAgencyBuyback(input),/differs/);
});
function fixture(){
  const mint=key(205).toBase58(),programId=key(206).toBase58(),authority=Keypair.fromSeed(Buffer.alloc(32,207));
  let observations=0,journals=0,state={},captured=null;
  const context={policy:{selectedMask:6,completedMask:0},agentRemaining:['0','2000000','2000000'],launch:{creatorWallet:key(208).toBase58(),
    pumpFeeRoute:{initialAuthority:authority.publicKey.toBase58(),protocolSplit:{agencyPercent:10}}}};
  const observation={marketCapUsdMicros:'99999999999'};
  const input={store:{read:async()=>state},connection:{},mint,agent:1,programId,approvedHash:'a'.repeat(64),authority,
    readContext:async()=>context,readObservation:async()=>{observations++;return observation;},
    journal:async args=>{journals++;captured=args;return{status:'verification-pending'};}};
  return{input,context,observation,get observations(){return observations;},get journals(){return journals;},get captured(){return captured;},
    save:row=>state={v3AgencyExecutions:{[`agency:${mint}:1:0`]:row}}};
}
test('milestones do not create financial intents below threshold or after a one-time completion',async()=>{
  const f=fixture();assert.equal((await runAgencyMilestone(f.input)).status,'below-threshold');assert.equal(f.journals,0);
  f.observation.marketCapUsdMicros='100000000000';assert.equal((await runAgencyMilestone(f.input)).status,'verification-pending');
  assert.equal(f.journals,1);assert.equal(f.captured.intent.maxBudgetLamports,'2000000');
  f.context.policy.completedMask=2;assert.equal((await runAgencyMilestone(f.input)).status,'not-payable');assert.equal(f.journals,1);
});
test('signed milestone recovery retains the exact intent without using a later quote or replenished fees',async()=>{
  const f=fixture();f.observation.marketCapUsdMicros='100000000000';await runAgencyMilestone(f.input);
  const intent=structuredClone(f.captured.intent),before=f.observations;f.save({intent,signature:'signed'});
  f.context.policy.completedMask=2;f.context.agentRemaining[1]='9000000';
  assert.equal((await runAgencyMilestone(f.input)).status,'verification-pending');assert.equal(f.observations,before);
  assert.deepEqual(f.captured.intent,intent);
});
