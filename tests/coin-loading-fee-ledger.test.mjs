import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinLoadingController, linkedSharedRouterFeeCollections,
  verifiedV3FeeLedger } from '../src/app/controllers/coin-loading.js';

test('creator fee fallback accepts only the selected mint and verified V3 scope', () => {
  const ledger={ mint:'mint-a', cluster:'devnet', overview:{ available:true, scope:'per-mint-v3' } };
  assert.equal(verifiedV3FeeLedger({ available:true, data:ledger },'mint-a','devnet'),ledger);
  assert.equal(verifiedV3FeeLedger({ available:true, data:ledger },'mint-b','devnet'),null);
  assert.equal(verifiedV3FeeLedger({ available:true, data:ledger },'mint-a','mainnet'),null);
  assert.equal(verifiedV3FeeLedger({ available:false, data:ledger },'mint-a','devnet'),null);
  assert.equal(verifiedV3FeeLedger({ available:true, data:{ ...ledger,
    overview:{ available:true, scope:'per-mint-v2' } } },'mint-a','devnet'),null);
});

test('verified V3 creator allocations remain visible when token RPC fails', async () => {
  const ledger={ mint:'mint-a', cluster:'devnet', source:'funded.app-postgresql',
    collections:[{ signature:'collection-a' }], claims:[],
    overview:{ available:true, scope:'per-mint-v3', creatorWallet:'creator-a' } };
  const rendered=[];
  const state={ coinLoadId:0, EXPLORE_CLUSTER:'devnet', coinActivity:null,
    loadCoinChat:async()=>{}, setCoinField:()=>{}, shortAddress:value=>value,
    apiRequest:async()=>({ available:true, data:ledger }),
    getSolana:async()=>{ throw new Error('Mint RPC unavailable'); },
    renderOnChainUnavailable:()=>{ state.coinActivity={ status:'unavailable' };
      state.coinSummaryLedgerMint=null;rendered.push('rpc-unavailable'); },
    renderCoinRegistryIdentity:()=>{},
    renderCoinFeeDashboard:overview=>rendered.push(overview),
    setCoinTabLabels:()=>{}, renderCoinActivityTab:()=>{},
  };
  const originalError=console.error;
  console.error=()=>{};
  try { await createCoinLoadingController(state).loadCoinOnChain('mint-a'); }
  finally { console.error=originalError; }
  assert.equal(state.coinSummaryLedgerMint,'mint-a');
  assert.equal(state.coinActivity.status,'unavailable');
  assert.deepEqual(state.coinActivity.collections,ledger.collections);
  assert.equal(rendered.at(-1),ledger.overview);
  assert(rendered.includes('rpc-unavailable'));
});

test('V3 fee activity without a shared router does not break token detail', () => {
  const response = { cluster:'devnet', collections:[], claims:[], sharedRouter:null };
  assert.deepEqual(linkedSharedRouterFeeCollections(response, undefined), { linked:false, collections:[] });
  assert.deepEqual(linkedSharedRouterFeeCollections(response, 'creator-address'), { linked:false, collections:[] });
});

test('combined collections appear only when the on-chain creator matches a real router address', () => {
  const response = { sharedRouter:{ address:'router-address', collections:[{ signature:'combined-fee' }] } };
  assert.deepEqual(linkedSharedRouterFeeCollections(response, 'other-creator'), { linked:false, collections:[] });
  assert.deepEqual(linkedSharedRouterFeeCollections(response, 'router-address'), {
    linked:true, collections:[{ signature:'combined-fee' }],
  });
});
