import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createBurnCheckedInstruction} from '@solana/spl-token';
import {PUMP_SDK} from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import {buildPumpLaunchPlan,buildMintRouterInitializeInstruction} from '../mint-router-launch.js';
import {normalizeInitialBuy} from '../launch-flow.js';
const payer=Keypair.generate().publicKey,program=Keypair.generate().publicKey;
const global={feeRecipient:Keypair.generate().publicKey,feeRecipients:[]};
let passed=0,blocked=0,split=0;
for(const long of [false,true])for(const buyPercent of [0,.1,10,20])for(const burn of [false,true])for(const isolated of [false,true]){
  const mint=Keypair.generate(),router=buildMintRouterInitializeInstruction({programId:program,mint:mint.publicKey,payer});
  const input={global,mint:mint.publicKey,name:long?'N'.repeat(32):'Fixture',symbol:long?'T'.repeat(10):'QA',uri:`https://metadata.funded.vip/devnet-metadata/${mint.publicKey}`,creator:router.router.address,user:payer,mayhemMode:false,cashback:false,holderReward:false};
  const buy=normalizeInitialBuy({initialBuyPercent:buyPercent,supply:1000000000,decimals:6});assert.ok(buy.amountBaseUnits<=200000000000000n);
  const instructions=buyPercent?await PUMP_SDK.createV2AndBuyInstructions({...input,amount:new BN(buy.amountBaseUnits.toString()),solAmount:new BN('100000000')}):[await PUMP_SDK.createV2Instruction(input)];
  const burnInstruction=burn?createBurnCheckedInstruction(Keypair.generate().publicKey,Keypair.generate().publicKey,payer,25000000000n,6):null;
  try{const plan=buildPumpLaunchPlan({payer,mint,blockhash:Keypair.generate().publicKey.toBase58(),launchInstructions:instructions,burnInstruction,mintRouterInstruction:isolated?router.instruction:null});assert.ok(plan.steps.every(step=>step.bytes<=1232));if(burn)assert.ok(plan.steps.at(-1).transaction.instructions.includes(burnInstruction));passed++;if(plan.mintRouterSeparate)split++;}
  catch(error){assert.match(error.message,/size limit/);blocked++;}
}
for(const initialBuyPercent of [-1,20.01,21,NaN,Infinity])assert.throws(()=>normalizeInitialBuy({initialBuyPercent,supply:1000000000,decimals:6}));
assert.equal(passed+blocked,32);
console.log(`Launch matrix: 32 combinations; ${passed} fit, ${split} use split router setup, ${blocked} safely blocked pre-signing; max 20% integer supply verified (local-only).`);
