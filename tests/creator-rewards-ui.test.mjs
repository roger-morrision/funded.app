import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { creatorRewardRow, filterCreatorRewards } from '../creator-reward-model.js';

const launch={mint:'mint-a',symbol:'ALPHA',creatorWallet:'creator',cluster:'devnet',onchainVerified:true};
test('creator reward filters retain pending balances and search names, tickers and addresses',()=>{
  const rows=[
    {name:'OLD',fullName:'Past launch',mint:'mint-old',unclaimed:0n,available:0n,ready:false},
    {name:'WAIT',fullName:'Pending launch',mint:'mint-wait',unclaimed:10n,available:0n,ready:false},
    {name:'NEW',fullName:'Current launch',mint:'mint-new',unclaimed:20n,available:20n,ready:true},
  ];
  assert.deepEqual(filterCreatorRewards(rows).map(r=>r.name),['NEW','WAIT']);
  assert.equal(filterCreatorRewards(rows,{filter:'all'}).length,3);
  for(const query of [' past ', 'OLD', 'mint-old']) assert.equal(filterCreatorRewards(rows,{filter:'all',query})[0].name,'OLD');
  assert.equal(filterCreatorRewards(rows,{query:'missing'}).length,0);
  assert.equal(rows[0].name,'OLD','Sorting must not mutate the source');
});
function activity(available='10000000', unpaid=available, paid='0') {
  return {mint:launch.mint,cluster:'devnet',overview:{available:true,creatorWallet:'creator',
    receivers:[{id:'creator',recipient:'creator',withoutConfirmedPayoutLamports:unpaid,confirmedPaidLamports:paid}],
    creatorClaim:{claimableLamports:available,minimumLamports:'10000000',eligible:BigInt(available)>=10000000n}}};
}
test('creator rewards distinguish claimable, below-minimum, processing, paid and empty states',()=>{
  const row=(...args)=>creatorRewardRow(launch,activity(...args),'creator','devnet');
  assert.equal(row().ready,true);
  assert.equal(row('1').status,'Below claim minimum');
  assert.equal(row('0','10000000').status,'Payment processing');
  assert.equal(row('0','0','10000000').paid,10000000n);
  assert.equal(row('0').status,'No rewards ready');
  const shared=activity('0'); shared.overview.receivers=[];
  assert.equal(creatorRewardRow(launch,shared,'creator','devnet').status,'No rewards ready');
});
test('creator rewards fail closed for another wallet, token, network or malformed amounts',()=>{
  for(const data of [{...activity(),mint:'other'},{...activity(),cluster:'mainnet-beta'},activity('-1'),activity('10000000','1')]) {
    assert.throws(()=>creatorRewardRow(launch,data,'creator','devnet'));
  }
  assert.throws(()=>creatorRewardRow(launch,activity(),'other','devnet'));
  assert.throws(()=>creatorRewardRow({...launch,onchainVerified:false},activity(),'creator','devnet'));
});

const source=await readAppSource();
const from=source.indexOf('async function requestCreatorFeeClaim('),to=source.indexOf('let coinMarketActivity',from);
function flow({switchAfterSign=false,reject=false,prepareUnavailable=false,rejectTransaction=false}={}) {
  const calls=[],messages=[];
  let changed=false;
  const transaction={serialize:()=>new Uint8Array([1,2,3])};
  const session={address:'creator',provider:{
    async signMessage(){ if(reject)throw new Error('Rejected'); changed=switchAfterSign;return new Uint8Array(64); },
    async signTransaction(){ if(rejectTransaction)throw new Error('Rejected transaction'); return transaction; },
  }};
  const context={TextEncoder,creatorClaimsInFlight:new Set(),captureWalletSession:()=>session,
    assertWalletSessionCurrent:()=>{if(changed)throw new Error('Wallet changed');},
    getCoinMintAddress:()=> 'different-open-token',showToast:m=>messages.push(m),bs58:{encode:()=> 'signature'},
    getSolana:async()=>({Transaction:{from:()=>transaction}}),base64ToBytes:()=>new Uint8Array([1]),
    bytesToBase64:()=> 'signed-transaction',
    apiRequest:async(path,options)=>{calls.push(path);
      if(path.endsWith('/creator-settlement-status'))return {available:true,data:{ready:true}};
      if(path.endsWith('/prepare'))return {available:!prepareUnavailable,data:{statement:'review',challengeId:'challenge'}};
      if(path.endsWith('/request'))return {available:true,data:{status:'awaiting-creator-signature',requestIds:['request-1']}};
      if(path.endsWith('/settle'))return options.body.creatorSignedTransaction
        ? {available:true,data:{status:'paid',signature:'finalized-signature'}}
        : {available:true,data:{status:'awaiting-creator-signature',creatorWallet:'creator',transaction:'prepared-transaction'}};
      return {available:true,data:{mint:'mint-a',overview:activity().overview}};
    },
    renderCoinFeeDashboard:()=>assert.fail('Must not render another open token')};
  vm.runInNewContext(source.slice(from,to),context);
  return {context,calls,messages,button:{isConnected:true,disabled:false,textContent:'Approve payouts'}};
}
test('Rewards claim signs the selected mint payout even when a different token page is open',async()=>{
  const f=flow();await f.context.requestCreatorFeeClaim(f.button,'mint-a',activity().overview);
  assert.deepEqual(f.calls,['/api/mint-router/creator-settlement-status',
    '/api/tokens/mint-a/creator-claim/prepare','/api/tokens/mint-a/creator-claim/request',
    '/api/tokens/mint-a/creator-claim/settle','/api/tokens/mint-a/creator-claim/settle',
    '/api/tokens/mint-a/fee-activity']);
  assert.equal(f.button.disabled,true);
  assert.match(f.messages.at(-1),/finalized on Devnet/);
  assert.equal(f.context.creatorClaimsInFlight.size,0);
});
test('wallet changes, rejection and unavailable preparation never submit a payout request',async()=>{
  for(const [options,expected] of [[{switchAfterSign:true},2],[{reject:true},2],[{prepareUnavailable:true},2]]) {
    const f=flow(options);await f.context.requestCreatorFeeClaim(f.button,'mint-a',activity().overview);
    assert.equal(f.calls.length,expected);assert.equal(f.context.creatorClaimsInFlight.size,0);
    assert.equal(f.calls.some(path=>path.endsWith('/request')),false);
  }
});
test('transaction rejection never submits a signed payout',async()=>{
  const f=flow({rejectTransaction:true});await f.context.requestCreatorFeeClaim(f.button,'mint-a',activity().overview);
  assert.equal(f.calls.filter(path=>path.endsWith('/settle')).length,1);
  assert.equal(f.context.creatorClaimsInFlight.size,0);
});
test('duplicate requests and non-owner wallets cannot start a claim',async()=>{
  const f=flow();f.context.creatorClaimsInFlight.add('mint-a');
  await f.context.requestCreatorFeeClaim(f.button,'mint-a',activity().overview);
  await f.context.requestCreatorFeeClaim(f.button,'mint-b',{...activity().overview,creatorWallet:'other'});
  assert.equal(f.calls.length,0);
});
