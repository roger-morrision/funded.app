import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorFeesRoutes } from '../server/routes/creator-fees.mjs';
import { renderCoinActivityTab } from '../src/features/coin/activity-view.js';

const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z';
const router='So11111111111111111111111111111111111111112';
const signature='3'.repeat(64);
function renderAmounts(claims, collections=[]) {
  const target={innerHTML:''}; let tab='claims';
  const document={querySelector:selector=>selector==='#coin-activity-list'?target:selector==='[data-coin-tab].active'?{dataset:{coinTab:tab}}:null};
  const render=()=>renderCoinActivityTab({coinMarketActivity:{},coinActivity:{status:'unavailable',ledgerAvailable:true,symbol:'TEST',claims,collections}}, {document,formatOnchainAge:()=>'',exploreExplorer:path=>`https://explorer.solana.com/${path}?cluster=devnet`,formatCoinUsd:()=>'$—'});
  render(); const allocationHtml=target.innerHTML;
  tab='payments'; render();
  return {allocationHtml,collectionHtml:target.innerHTML};
}

test('actual V3 adapter and renderer agree on exact SOL units without modifying the ledger', async () => {
  const prior=process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
  process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID=router;
  const amounts=['25887','1','0','18446744073709551615',Number.MAX_SAFE_INTEGER+1,null,'garbage'];
  const expected=['0.000025887','0.000000001','0','18,446,744,073.709551615',null,null,null];
  const state={launches:{[mint]:{mint,cluster:'devnet',onchainVerified:true,creator:router,creatorWallet:router,pumpFeeRoute:{scope:'per-mint-v3',router,programId:router}}},collections:{},v3Settlements:{}};
  for(const [i,amount] of amounts.entries()) {
    const sig=String(i+3).repeat(64);
    state.collections[sig]={signature:sig,mint,router,programId:router,scope:'per-mint-v3',status:'collected',onchainVerified:true,collectedLamports:amount};
    state.v3Settlements[sig]={status:'finalized'};
  }
  const before=JSON.stringify(state); let response;
  try {
    const handle=createCreatorFeesRoutes({store:{read:async()=>state},solanaCluster:'devnet',route:(path,_method,pattern)=>path.match(pattern)?.[1],solanaRpcUrl:'invalid-offline-url',databaseUrl:null,respond:(_res,status,data)=>response={status,data}});
    await handle({method:'GET'},{},new URL(`https://funded.vip/api/tokens/${mint}/fee-activity`));
    assert.equal(response.status,200);
    for(const [i,claim] of response.data.claims.entries()) {
      assert.equal(claim.grossLamports,expected[i] == null ? null : amounts[i]);
      assert.equal(claim.grossCreatorFeesUnit,'SOL');
      const {allocationHtml,collectionHtml}=renderAmounts([claim],[response.data.collections[i]]);
      for(const html of [allocationHtml,collectionHtml]) assert.ok(html.includes(expected[i] == null ? 'class="coin-fee-amount">—</td>' : `${expected[i]} SOL`),html);
      assert.equal(claim.status,'finalized');
      assert.ok(allocationHtml.includes('These amounts may not have been paid yet.'));
      assert.ok(allocationHtml.includes(claim.claimSignature));
    }
    assert.equal(response.data.claims[0].grossCreatorFees,'0.000025887');
    assert.equal(JSON.stringify(state),before,'Public projection must not mutate persisted records');
  } finally {
    if(prior===undefined)delete process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;else process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID=prior;
  }
});

test('legacy SOL-major allocations retain exact values and are not converted twice', () => {
  for(const [amount,expected] of [['0.000025887','0.000025887'],[0.000000001,'0.000000001'],['0','0'],['18446744073.709551615','18,446,744,073.709551615']]) {
    const {allocationHtml}=renderAmounts([{claimSignature:signature,asset:'SOL',grossCreatorFees:amount,status:'obligations_created'}]);
    assert.ok(allocationHtml.includes(`${expected} SOL`),allocationHtml);
    assert.ok(allocationHtml.includes('Shares recorded'));
  }
});

test('unknown, malformed, imprecise and conflicting allocation denominations are unavailable', () => {
  const rows=[{}, {grossCreatorFees:null}, {grossCreatorFees:''}, {grossCreatorFees:true},
    {grossCreatorFees:'NaN'}, {grossCreatorFees:'-1'}, {grossCreatorFees:'0.0000000001'},
    {grossCreatorFees:Infinity}, {grossCreatorFees:Number.MAX_SAFE_INTEGER+1},
    {grossCreatorFees:'25887',grossCreatorFeesUnit:'lamports'},
    {grossCreatorFees:'1',asset:'UNKNOWN'}, {grossCreatorFees:'1',asset:null},
    {grossLamports:null,grossCreatorFees:'1'}, {grossLamports:'1.5'}, {grossLamports:'-1'},
    {grossLamports:Number.MAX_SAFE_INTEGER+1}, {grossLamports:'1',grossCreatorFees:'1'},
    {grossLamports:'1',grossCreatorFeesUnit:'unknown'}];
  for(const item of rows) {
    const {allocationHtml}=renderAmounts([{claimSignature:signature,asset:'SOL',...item}]);
    assert.ok(allocationHtml.includes('class="coin-fee-amount">—</td>'),JSON.stringify(item));
  }
  for(const value of [null,'',true,'garbage','-1','1.5',Number.MAX_SAFE_INTEGER+1]) {
    const {collectionHtml}=renderAmounts([],[{signature,collectedLamports:value}]);
    assert.ok(collectionHtml.includes('class="coin-fee-amount">—</td>'),String(value));
  }
});
