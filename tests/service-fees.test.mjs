import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { DEFAULT_SERVICE_FEES, validateServiceFees } from '../service-fees.js';
import { serviceFeeSnapshot, handleAdminServiceFees } from '../server/service-fees.mjs';
import { createLaunchQuoteRoutes } from '../server/routes/launch-quotes.mjs';
import { createAdminRoutes } from '../server/routes/admin.mjs';
import { createListingPaymentsRoutes } from '../server/routes/listing-payments.mjs';
import { launchServiceFeeInstructions } from '../launch-service-fee.js';
import { verifyLaunchServiceFee } from '../server/launch-service-fee-proof.mjs';
import { launchTierAmounts } from '../launch-tier-quote.js';
import { listingBurnBaseUnitsForUsd, listingQuoteCurrent } from '../listing-policy.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { quoteLaunchServiceFee } from '../src/features/fees/service-fees-client.js';

const payer = Keypair.generate(), treasury = Keypair.generate(), mint = Keypair.generate();
const address = key => key.publicKey.toBase58();
test('concurrent estimates reuse one valid fee quote while wallet or policy changes request another',async()=>{
  let calls=0;
  const state={apiRequest:async(_path,{body})=>{calls++;await Promise.resolve();return{available:true,data:{payer:body.payer,policyHash:body.expectedHash,recipient:address(treasury),amountLamports:'20000000',expiresAt:new Date(Date.now()+600000).toISOString()}};}};
  const fees={hash:'a'.repeat(64),policy:DEFAULT_SERVICE_FEES,recipient:address(treasury)};
  const rows=await Promise.all(Array.from({length:5},()=>quoteLaunchServiceFee(state,fees,address(payer))));
  assert.equal(calls,1);assert(rows.every(row=>row===rows[0]));
  await quoteLaunchServiceFee(state,fees,address(payer));assert.equal(calls,1);
  await quoteLaunchServiceFee(state,{...fees,hash:'b'.repeat(64)},address(payer));assert.equal(calls,2);
  await quoteLaunchServiceFee(state,fees,address(mint));assert.equal(calls,3);
});
function fixture() {
  const state = { launches:{}, adminSettings:{}, adminAudit:{} };
  const store = { read:async () => structuredClone(state), update:async callback => callback(state), chargeRpcRate:async () => true };
  let result, input, count = 0, cookie = '';
  const respond = (_, status, data) => { result = { status, data }; };
  const env = { CORS_ORIGIN:'https://funded.vip', PUBLIC_APP_URL:'https://funded.vip', FUNDED_ADMIN_WALLETS:address(payer), FUNDED_TRADE_FEE_OWNER:address(treasury) };
  const context = { store,body:async () => input, respond,env,clientKey:()=> 'qa',
    fundedTokenMint:address(mint), id:prefix => `${prefix}_${++count}_0123456789abcdef`,
    currentLaunchTierPricing:async () => ({tokenPriceUsd:0.01,pool:address(mint),slot:10,source:'verified-pump-swap-pool'}) };
  const call = async (handler, method, path, value, headers = {}) => {
    input = value; result = null;
    await handler({method,headers:{origin:'https://funded.vip',host:'funded.vip',cookie,...headers},socket:{remoteAddress:'127.0.0.1'}},
      {setHeader(key,value){ if(key==='set-cookie') cookie=value.split(';')[0]; }},new URL(path,'https://funded.vip')); return result;
  };
  return {state,store,context,call};
}

test('recommended service fees are exact, bounded and independent from creator distribution', () => {
  assert.deepEqual(validateServiceFees(DEFAULT_SERVICE_FEES),{tradeBps:75,launchLamports:'20000000',proUsd:150,premierUsd:300,listingUsd:300});
  for (const patch of [{tradeBps:501},{tradeBps:0.5},{launchLamports:'0.02'},{launchLamports:20000000},{launchLamports:'5000000001'},{proUsd:0},{premierUsd:150},{listingUsd:300.5},{other:1}])
    assert.throws(() => validateServiceFees({...DEFAULT_SERVICE_FEES,...patch}));
});

test('admin policy uses revision/hash compare and immutable audit; stale writes cannot overwrite', async () => {
  const {state,store,context} = fixture(); let output;
  const save = async value => handleAdminServiceFees({ req:{method:'POST'},res:{},url:new URL('https://funded.vip/api/admin/service-fees'),
    store,body:async()=>value,respond:(_,status,data)=>{output={status,data};},session:{wallet:address(payer)} });
  const old = serviceFeeSnapshot(state), policy = {...old.policy,tradeBps:80,proUsd:175};
  await save({policy,expectedRevision:0,expectedHash:old.hash,reason:'QA reviewed pricing update'});
  assert.equal(output.status,200); assert.equal(output.data.revision,1); assert.equal(state.adminAudit['service-fees:1'].wallet,address(payer));
  assert.notEqual(output.data.hash,old.hash);
  await save({policy,expectedRevision:0,expectedHash:old.hash,reason:'Stale second pricing update'});
  assert.equal(output.status,409); assert.equal(state.adminSettings.serviceFees.revision,1);
  await save({policy,expectedRevision:1,expectedHash:output.data.hash,reason:'short'}); assert.equal(output.status,409);
});

test('real admin route requires allowlisted wallet signature, same origin and session for fee edits', async () => {
  const {context,call,state} = fixture(); const handler = createAdminRoutes({...context,solanaCluster:'devnet'});
  assert.equal((await call(handler,'POST','/api/admin/service-fees',{})).status,401);
  assert.equal((await call(handler,'POST','/api/admin/challenge',{wallet:address(payer)},{origin:'https://evil.example'})).status,403);
  const challenge = await call(handler,'POST','/api/admin/challenge',{wallet:address(payer)});
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.data.message),payer.secretKey));
  const input = {wallet:address(payer),nonce:challenge.data.nonce,signature};
  assert.equal((await call(handler,'POST','/api/admin/session',input)).status,200);
  const snapshot = await call(handler,'GET','/api/admin/service-fees'); assert.equal(snapshot.status,200);
  const saved = await call(handler,'POST','/api/admin/service-fees',{policy:{...DEFAULT_SERVICE_FEES,tradeBps:80},expectedHash:snapshot.data.hash,expectedRevision:0,reason:'Signed QA admin fee update'});
  assert.equal(saved.status,200); assert.equal(state.adminSettings.serviceFees.policy.tradeBps,80);
  assert.equal((await call(handler,'POST','/api/admin/logout',{})).status,200);
  assert.equal((await call(handler,'GET','/api/admin/service-fees')).status,401);
});

test('new quotes track admin edits while issued promotion/listing quotes retain their original amount', async () => {
  const {context,call,state} = fixture(), handler = createLaunchQuoteRoutes(context);
  const first = await call(handler,'POST','/api/launch-tier-quote',{tier:'pro',payer:address(payer)});
  assert.equal(first.data.usd,150); assert.equal(first.data.amountTokens,15000);
  const fees = await call(handler,'GET','/api/service-fees');
  const launch = await call(handler,'POST','/api/launch-service-quote',{payer:address(payer),expectedHash:fees.data.hash});
  assert.equal(launch.data.amountLamports,'20000000');
  state.adminSettings.serviceFees = {policy:{...DEFAULT_SERVICE_FEES,proUsd:180,launchLamports:'30000000'},revision:1};
  const next = await call(handler,'POST','/api/launch-tier-quote',{tier:'pro',payer:address(payer)});
  assert.equal(next.data.usd,180); assert.equal(next.data.amountTokens,18000);
  assert.equal(state.launchTierQuotes[first.data.id].usd,150);
  assert.equal(state.launchServiceQuotes[launch.data.id].amountLamports,'20000000');
  assert.equal((await call(handler,'POST','/api/launch-service-quote',{payer:address(payer),expectedHash:fees.data.hash})).status,409);
  assert.equal(launchTierAmounts(0.01,{...DEFAULT_SERVICE_FEES,proUsd:180}).pro,18000);
  assert.equal(listingBurnBaseUnitsForUsd(0.01,6,400),40000000000n);
});

test('funded.vip launches are not charged an external listing fee', async () => {
  const {state,context,call} = fixture();
  state.launches[address(mint)] = {onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3'}};
  const handler = createListingPaymentsRoutes({...context,solanaCluster:'devnet',walletKey:value=>value});
  const result = await call(handler,'POST','/api/listings/quote',{mint:address(mint),payer:address(payer)});
  assert.equal(result.status,409); assert.equal(result.data.included,true); assert.equal(state.listingQuotes,undefined);
});

function feeProof() {
  const now=Date.now(), quote={id:'launch_service_1_0123456789abcdef',payer:address(payer),recipient:address(treasury),
    amountLamports:'20000000',policyHash:serviceFeeSnapshot().hash,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
  const ix=launchServiceFeeInstructions({payer:payer.publicKey,mint:mint.publicKey,quote});
  const keys=[payer.publicKey,treasury.publicKey,...ix.map(x=>x.programId)];
  const tx={slot:12,blockTime:Math.floor(now/1000),meta:{err:null,preBalances:[1000000000,1000000,0,0],postBalances:[979995000,21000000,0,0]},
    transaction:{signatures:['signature'],message:{accountKeys:keys,instructions:ix.map((row,index)=>({programIdIndex:index+2,accounts:row.keys.map(k=>k.pubkey.equals(payer.publicKey)?0:1),data:bs58.encode(row.data)}))}}};
  return {quote,transaction:tx,signature:'signature',mint:address(mint),payer:address(payer)};
}

test('atomic launch charge binds saved quote, mint memo, exact treasury credit and finalized transaction', () => {
  const input=feeProof(), proof=verifyLaunchServiceFee(input);
  assert.equal(proof.amountLamports,'20000000'); assert.equal(proof.finalized,true); assert.equal(proof.balanceDeltaVerified,true);
  for(const mutate of [x=>{x.transaction.meta.err={};},x=>{x.transaction.meta.postBalances[1]--;},
    x=>{x.quote.recipient=address(mint);},x=>{x.mint=address(treasury);},x=>{x.quote.amountLamports='10000000';},
    x=>{x.transaction.transaction.message.instructions.pop();},x=>{x.transaction.transaction.message.instructions.push(x.transaction.transaction.message.instructions[0]);},
    x=>{x.transaction.blockTime+=1000;},x=>{x.quote.createdAt='invalid';}]) {
    const changed=structuredClone(input); mutate(changed);
    // PublicKey instances must be preserved by the transaction decoder, as in RPC.
    changed.transaction.transaction.message.accountKeys=input.transaction.transaction.message.accountKeys;
    assert.throws(()=>verifyLaunchServiceFee(changed));
  }
});

test('a zero launch fee still requires the quoted mint memo and cannot be fabricated from a transfer elsewhere', () => {
  const input=feeProof(); input.quote.amountLamports='0';
  const ix=launchServiceFeeInstructions({payer:payer.publicKey,mint:mint.publicKey,quote:input.quote});
  assert.equal(ix.length,1);
  assert.throws(()=>launchServiceFeeInstructions({payer:treasury.publicKey,mint:mint.publicKey,quote:input.quote}));
});
