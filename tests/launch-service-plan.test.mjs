import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { buildPumpLaunchPlan } from '../mint-router-launch.js';
import { launchServiceFeeInstructions } from '../launch-service-fee.js';

function fixture() {
  const payer=Keypair.generate().publicKey,mint=Keypair.generate(),program=Keypair.generate().publicKey,treasury=Keypair.generate().publicKey;
  const shared=Array.from({length:12},()=>Keypair.generate().publicKey);
  const lookup=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,authority:payer,addresses:[...shared,treasury,new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')]}});
  const instruction=(size,signer=false)=>new TransactionInstruction({programId:program,keys:[{pubkey:mint.publicKey,isSigner:signer,isWritable:true},...shared.map(pubkey=>({pubkey,isSigner:false,isWritable:false}))],data:Buffer.alloc(size,7)});
  const service=launchServiceFeeInstructions({payer,mint:mint.publicKey,quote:{id:'launch_service_1_0123456789abcdef',payer:payer.toBase58(),recipient:treasury.toBase58(),amountLamports:'20000000',policyHash:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()}});
  return {payer,mint,blockhash:Keypair.generate().publicKey.toBase58(),lookupTable:lookup,launchInstructions:[instruction(550,true)],burnInstruction:instruction(10),mintRouterInstruction:instruction(450,true),reserveInstructions:[instruction(100),...service],service};
}
test('oversized combined message splits router setup and preserves atomic creation, burn, reserve and service payment',()=>{
  const f=fixture(),plan=buildPumpLaunchPlan(f);
  assert.equal(plan.mintRouterSeparate,true);assert.equal(plan.steps.length,2);
  assert(plan.steps.every(step=>step.bytes<=1232));
  const data=plan.steps[1].transaction.message.compiledInstructions.map(row=>Buffer.from(row.data));
  for(const expected of [...f.launchInstructions,f.burnInstruction,...f.reserveInstructions])assert(data.some(row=>row.equals(expected.data)));
});
test('an oversized creation transaction is rejected before any wallet signing or send',()=>{
  const f=fixture();f.launchInstructions[0].data=Buffer.alloc(1300);
  assert.throws(()=>buildPumpLaunchPlan(f),/Atomic community reserve transaction.*above Solana/);
});
