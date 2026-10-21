import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinLoadingController } from '../src/app/controllers/coin-loading.js';
import { createCoinCommunityController } from '../src/app/controllers/coin-community.js';
import { renderCoinActivityTab } from '../src/features/coin/activity-view.js';

async function unavailable(message,{ledger=false,mint='fixture-mint'}={}) {
  const priorDocument=globalThis.document, priorError=console.error;
  const fields=new Map(),log=[],activity={innerHTML:''};let tab='holders';
  globalThis.document={querySelector:selector=>selector==='#coin-activity-list'?activity:selector==='[data-coin-tab].active'?{dataset:{coinTab:tab}}:null};
  console.error=(...args)=>log.push(args.map(String).join(' '));
  const feeLedger={mint,cluster:'devnet',overview:{available:true,scope:'per-mint-v3'},collections:[{signature:'3'.repeat(64),collectedLamports:'25887'}],claims:[{claimSignature:'3'.repeat(64),asset:'SOL',grossCreatorFees:'0.000025887',status:'finalized'}]};
  const values={coinLoadId:0,EXPLORE_CLUSTER:'devnet',apiRequest:async()=>({available:ledger,data:feeLedger}),getSolana:async()=>{throw new Error(message)},shortAddress:value=>value,setCoinField:(selector,value)=>fields.set(selector,value),formatOnchainAge:()=>'',exploreExplorer:path=>`https://explorer.solana.com/${path}?cluster=devnet`,formatCoinUsd:()=>'$—'};
  const state=new Proxy(values,{get:(object,key)=>key in object?object[key]:(()=>{})});
  state.renderCoinActivityTab=()=>renderCoinActivityTab(state,{...values,document:globalThis.document});
  state.renderOnChainUnavailable=createCoinCommunityController(state).renderOnChainUnavailable;
  try {
    await createCoinLoadingController(state).loadCoinOnChain(mint);
    const result={message:state.coinActivity.message,title:fields.get('#coin-page-title'),description:fields.get('#coin-description'),html:activity.innerHTML,log,ledger:state.coinActivity.ledgerAvailable};
    tab='payments';state.renderCoinActivityTab();result.collections=activity.innerHTML;
    tab='claims';state.renderCoinActivityTab();result.claims=activity.innerHTML;
    return result;
  } finally {globalThis.document=priorDocument;console.error=priorError;}
}

test('actual token loading and unavailable presentation bound unknown upstream bodies and diagnostics',async()=>{
  for(const message of ['502 : <!DOCTYPE html><footer>Fixture upstream 192.0.2.1<script>fixture()</script></footer>','503 : fixture provider at https://rpc.example.invalid/private diagnostic','Error: '+ 'fixture '.repeat(1000)]) {
    const result=await unavailable(message);
    assert.equal(result.title,'Token data unavailable');
    assert.equal(result.message,'We could not load verified token details. Try Refresh in a moment.');
    assert.equal(result.description,result.message);
    assert.ok(result.html.includes(result.message));
    assert.doesNotMatch(result.html+result.description+result.log.join(' '),/DOCTYPE|script|footer|192\.0\.2\.1|rpc\.example|private diagnostic|fixture/);
    assert.ok(result.message.length<120);
    assert.ok(result.collections.includes('Token data unavailable'));
  }
});

test('rate limit, timeout, local mint validation and safe not-found errors retain specific recovery',async()=>{
  for(const [message,expected] of [['429 Too Many Requests','rate limited'],['Mint RPC request timed out','timed out'],['TimeoutError','timed out'],['Invalid public key input','valid Solana token mint'],['Non-base58 character','valid Solana token mint'],['Mint account was not returned by Solana RPC.','Mint account was not returned by Solana RPC.']]) {
    const result=await unavailable(message);
    assert.ok(result.message.includes(expected),result.message);
    assert.ok(result.message.length<120);
  }
  const result=await unavailable('',{mint:''});
  assert.equal(result.message,'Choose a token from Explore to see its details.');
});

test('bounded token failures preserve genuinely available collections and allocation records',async()=>{
  const result=await unavailable('502 : <!DOCTYPE html><script>fixture()</script>',{ledger:true});
  assert.equal(result.ledger,true);
  assert.ok(result.html.includes('Token data unavailable'));
  assert.ok(result.collections.includes('0.000025887 SOL'));
  assert.ok(result.claims.includes('0.000025887 SOL'));
  assert.ok(result.claims.includes('These amounts may not have been paid yet.'));
  assert.doesNotMatch(result.html+result.collections+result.claims,/DOCTYPE|script&gt;|fixture/);
});
