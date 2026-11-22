import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,SystemProgram,ComputeBudgetProgram,Keypair} from '@solana/web3.js';
import {reviewTokenSellConversion,tokenPricePolicyHash} from '../../server/token-conversion-sell-review.mjs';
import {sellReviewFixture} from './token-sell-review-fixture.mjs';
const key=n=>new PublicKey(new Uint8Array(32).fill(n));
const rebindUnitPolicy=f=>{f.release.priceSignerPolicy=structuredClone(f.config);f.release.independentReview.priceSignerPolicySha256=tokenPricePolicyHash(f.config);};

for(const category of [5,6,7])for(const prefund of [0,700000])test('unsigned full conversion review uses actual market/account codecs for category '+category+' and prefund '+prefund,async()=>{
  const f=sellReviewFixture({category,prefund}),review=await reviewTokenSellConversion(f.args());
  assert.equal(review.amountIn,'1000000');assert.equal(review.receivedLamports,'14211301');assert.equal(review.category,category);
  assert.equal(review.budgetAsset,f.built.quoteMint);assert.equal(f.simulationCalls,1);
  assert.ok(review.transaction.signatures.every(signature=>signature.every(byte=>byte===0)));
});

test('incomplete release and absent independent typed policy review cannot trigger RPC review',async()=>{
  const f=sellReviewFixture();f.connection.getGenesisHash=()=>assert.fail('No RPC for unadmitted release');
  await assert.rejects(reviewTokenSellConversion({...f.args(),release:undefined}),/production/);
  delete f.release.priceSignerPolicy;await assert.rejects(reviewTokenSellConversion(f.args()),/policy review/);
});

test('changed policy, policy digest, role separation or requested program cannot enter review',async()=>{
  for(const mutate of [f=>{f.config.quotePolicy.maxOrderQuoteRaw='10000001';},f=>{f.release.independentReview.priceSignerPolicySha256='0'.repeat(64);},
    f=>{f.config.authority=f.config.priceSigner;rebindUnitPolicy(f);},f=>{f.config.priceSigner=f.config.upgradeAuthority;rebindUnitPolicy(f);},
    f=>{f.request.programId=String(key(80));}]){const f=sellReviewFixture();mutate(f);await assert.rejects(reviewTokenSellConversion(f.args()));assert.equal(f.simulationCalls,0);}
});

test('actual reviewer rejects a pre-signed message and wrong genesis before market reads',async()=>{
  const f=sellReviewFixture();f.unsigned.sign([Keypair.fromSeed(new Uint8Array(32).fill(33))]);f.request.transaction=Buffer.from(f.unsigned.serialize()).toString('base64');
  await assert.rejects(reviewTokenSellConversion(f.args()),/unsigned/);assert.equal(f.market.reads.length,0);
  const g=sellReviewFixture();g.connection.getGenesisHash=async()=> 'wrong-network';await assert.rejects(reviewTokenSellConversion(g.args()),/genesis/);assert.equal(g.market.reads.length,0);
});

test('caller quote, reserve and recipient hints cannot replace independent raw market pricing',async()=>{
  const f=sellReviewFixture();Object.assign(f.request,{expectedLamports:'1',reserves:'huge',protocolRecipients:[String(key(80))],rpcUrl:'https://untrusted.invalid'});
  const review=await reviewTokenSellConversion({...f.args(),marketQuote:()=>assert.fail('No quote-verifier stub')});
  assert.equal(review.receivedLamports,'14211301');assert.equal(f.market.reads.length,2);
  const g=sellReviewFixture();g.built.instruction.data.writeBigUInt64LE(1n,49);g.rebuild();await assert.rejects(reviewTokenSellConversion(g.args()),/protection/);assert.equal(g.simulationCalls,0);
});

test('paused guard, wrong current operator, inactive price signer and used receipt reject new review',async()=>{
  for(const mutate of [f=>{f.beforeRows.get(f.addresses.router).data[106]=1;},f=>{key(80).toBuffer().copy(f.beforeRows.get(f.addresses.router).data,41);},
    f=>{f.beforeRows.get(f.addresses.price).data[39]^=1;},f=>{f.beforeRows.set(f.addresses.receipt,f.receiptAccount);}]){
    const f=sellReviewFixture();mutate(f);await assert.rejects(reviewTokenSellConversion(f.args()));assert.equal(f.simulationCalls,0);
  }
});

test('category spend cannot exceed token balance or its actual settled allocation',async()=>{
  for(const mutate of [f=>{f.beforeRows.get(f.addresses.token).data.writeBigUInt64LE(999999n,64);},
    f=>{const data=f.beforeRows.get(f.addresses.ledger).data;data.writeBigUInt64LE(data.readBigUInt64LE(80+5*8)-999999n,144+5*8);},
    f=>{const data=f.beforeRows.get(f.addresses.ledger).data;data.writeBigUInt64LE(data.readBigUInt64LE(80+5*8)+1n,80+5*8);},
    f=>{f.beforeRows.get(f.addresses.ledger).data.writeBigUInt64LE(1n,208);},
    f=>{f.beforeRows.get(f.addresses.policy).data.writeBigUInt64LE(1n,140+5*8);}]){
    const f=sellReviewFixture();mutate(f);await assert.rejects(reviewTokenSellConversion(f.args()));assert.equal(f.simulationCalls,0);
  }
});

test('wrong USDC custody or malformed WSOL prefund cannot reach simulation',async()=>{
  for(const mutate of [f=>{f.beforeRows.get(f.addresses.token).data[0]^=1;},f=>{f.beforeRows.get(f.addresses.token).data[32]^=1;},
    f=>{f.beforeRows.set(f.addresses.wsol,{...f.beforeRows.get(f.addresses.token)});}]){
    const f=sellReviewFixture();mutate(f);await assert.rejects(reviewTokenSellConversion(f.args()));assert.equal(f.simulationCalls,0);
  }
});

test('extra transfers, changed writable privileges and reordered fee setup are not canonical',async()=>{
  for(const mutate of [instructions=>instructions.unshift(SystemProgram.transfer({fromPubkey:Keypair.fromSeed(new Uint8Array(32).fill(33)).publicKey,toPubkey:key(80),lamports:1})),
    instructions=>{instructions.at(-1).keys[3].isWritable=true;},instructions=>{[instructions[0],instructions[1]]=[instructions[1],instructions[0]];}]){
    const f=sellReviewFixture();f.rebuild(mutate);await assert.rejects(reviewTokenSellConversion(f.args()));assert.equal(f.simulationCalls,0);
  }
});

test('unapproved priority fee, unavailable or changed lookup table cannot be reviewed',async()=>{
  const f=sellReviewFixture();f.rebuild(instructions=>instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({microLamports:1})));
  await assert.rejects(reviewTokenSellConversion(f.args()),/priority fee/);
  const g=sellReviewFixture();g.connection.getAddressLookupTable=async()=>({value:null});await assert.rejects(reviewTokenSellConversion(g.args()),/lookup table/);
  const h=sellReviewFixture();const index=h.table.state.addresses.findIndex(a=>String(a)===h.built.pool);h.table.state.addresses[index]=key(80);
  await assert.rejects(reviewTokenSellConversion(h.args()));assert.equal(h.simulationCalls,0);
});

test('expired blockhash, stale accounting snapshot and protected reserve shortage reject',async()=>{
  const f=sellReviewFixture();f.blockhashValid=false;await assert.rejects(reviewTokenSellConversion(f.args()),/expired/);
  const g=sellReviewFixture(),read=g.connection.getMultipleAccountsInfoAndContext;g.connection.getMultipleAccountsInfoAndContext=async(...args)=>{
    const result=await read(...args);return args[0].length===8?{...result,context:{slot:result.context.slot-1}}:result;};
  await assert.rejects(reviewTokenSellConversion(g.args()),/backwards/);
  const h=sellReviewFixture();h.balance=3000000000;await assert.rejects(reviewTokenSellConversion(h.args()),/reserve/);assert.equal(h.simulationCalls,0);
});

test('simulation failure or mismatched receipt, debit, credit, category or closure cannot produce a review',async()=>{
  for(const mutate of [result=>{result.value.err={InstructionError:[0,'test']};},result=>{result.context.slot-=1;},
    result=>{result.value.accounts[0].lamports+=700000;},result=>{result.value.accounts[2]=result.value.accounts[1];},
    ...[[1,64],[3,137],[4,80],[5,184],[6,180]].map(([index,offset])=>result=>{
      const account=result.value.accounts[index],data=Buffer.from(account.data[0],'base64');data[offset]^=1;account.data[0]=data.toString('base64');})]){
    const f=sellReviewFixture({prefund:700000});f.mutateSimulation=result=>{mutate(result);return result;};
    await assert.rejects(reviewTokenSellConversion(f.args()));assert.equal(f.simulationCalls,1);
  }
});

test('deployment changes during simulation cannot escape the final uncached context check',async()=>{
  const f=sellReviewFixture();f.mutateSimulation=result=>{f.programData={...f.programData,data:Buffer.from(f.programData.data)};f.programData.data[4]^=1;return result;};
  await assert.rejects(reviewTokenSellConversion(f.args()));assert.equal(f.simulationCalls,1);assert.equal(f.contextReads.length,4);
});
