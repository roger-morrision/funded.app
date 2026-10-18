import test from 'node:test';
import assert from 'node:assert/strict';
import {fundedBuyFailureMessage,fundedBurnFailureMessage} from '../src/features/funded/buy-feedback.js';
import {createFundedTradingController} from '../src/app/controllers/funded-trading.js';
import {createAirdropDirectoryController} from '../src/app/controllers/airdrop-directory.js';
import {airdropClaimState} from '../airdrop-directory-model.js';

test('buy failures never echo provider HTML, internal details or endpoint credentials',()=>{
  for(const message of ['502 : <!DOCTYPE html><html>proxy failure</html>',
    'failed to fetch https://rpc.invalid/?api-key=private-test-value',
    'Unexpected internal details: private-test-value']) {
    for(const phase of ['preview','buy']) {
      const result=fundedBuyFailureMessage(new Error(message),phase);
      assert.doesNotMatch(result,/<|https?:|private-test-value|Unexpected internal/);
      assert.match(result,/Try again|try again/);
    }
    assert.doesNotMatch(fundedBurnFailureMessage(new Error(message)),/<|https?:|private-test-value/);
  }
  assert.match(fundedBuyFailureMessage(new Error('429 max usage reached')),/rate limited/);
  assert.equal(fundedBuyFailureMessage({code:4001,message:'rejected'}),'Wallet approval was cancelled.');
});

test('a failed pool refresh clears the quote and shows a safe unavailable state',async()=>{
  const state={APP_CLUSTER:'devnet',APP_MAINNET_READ_ONLY:false,PROTOCOL_FUNDED_MINT:'mint',PROTOCOL_FUNDED_SWAP_POOL:'pool',
    fundedBuyBusy:false,fundedBuyPreview:{old:true},withRpcRetry:fn=>fn(0),getTradePreviewConnection:async()=>({}),
    fetchVerifiedPoolSnapshot:async()=>{throw new Error('502 <!DOCTYPE html>private-test-value');},
    renderFundedBuyControl(){},renderFundedTokenLanding(){}};
  await createFundedTradingController(state).refreshFundedBuyRoute();
  assert.equal(state.fundedBuyPreview,null);
  assert.equal(state.fundedBuyRoute.status,'unavailable');
  assert.doesNotMatch(state.fundedBuyRoute.reason,/<|private-test-value/);
  assert.match(state.fundedBuyRoute.reason,/connection could not be verified/);
});

test('airdrop availability distinguishes failed verification, pending snapshots, and active claims',()=>{
  const state={verifiedLaunchPolicies:[{mint:'fixture',communityAirdrop:{allocationPercent:3,reservedTokens:30_000_000}}],
    verifiedCommunityReserves:new Map(),communityReserveStatus:'unavailable',assets:[],airdropClaimState};
  const controller=createAirdropDirectoryController(state);
  let row=controller.getAirdropPrograms()[0];
  assert.equal(row.claimVerification,'unavailable');
  assert.equal(controller.directoryWalletAmount(row),'Claim status unavailable');
  assert.equal(row.marketStageKnown,false);
  state.communityReserveStatus='loading';
  row=controller.getAirdropPrograms()[0];
  assert.equal(controller.directoryWalletAmount(row),'Checking claim status…');
  state.communityReserveStatus='ready';
  state.verifiedCommunityReserves.set('fixture',{verified:true,status:'funded'});
  row=controller.getAirdropPrograms()[0];
  assert.equal(row.claimVerification,'verified');
  assert.equal(row.claimActive,false);
  assert.equal(controller.directoryWalletAmount(row),'Check when claims open');
  state.verifiedCommunityReserves.set('fixture',{verified:true,status:'drop-active',expiresAt:Math.floor(Date.now()/1000)+3600});
  state.assets=[{address:'fixture',complete:false}];
  row=controller.getAirdropPrograms()[0];
  assert.equal(row.claimActive,true);
  assert.equal(row.marketStageKnown,true);
  assert.equal(controller.directoryWalletAmount(row),'Connect to check');
});

test('burn failure messages preserve a submitted signature without exposing provider bodies',async t=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>prior?Object.defineProperty(globalThis,'document',prior):delete globalThis.document);
  const signature='3'.repeat(64);
  for(const mode of ['not-submitted','uncertain','failed']) {
    const submitted=mode!=='not-submitted';
    const fields={'#funded-burn-amount':{value:'1'},'#funded-burn-project':{value:''},'#funded-burn-submit':{textContent:''}};
    Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:s=>fields[s]}});
    let sends=0;
    const provider={publicKey:'fixture-wallet',signTransaction:async()=>({serialize:()=>new Uint8Array()})};
    const failure=()=>{throw new Error('502 <!DOCTYPE html>private-test-value');};
    const state={wallet:provider,captureWalletSession:()=>({address:'fixture-wallet',provider}),canSignTransactions:()=>true,
      fundedBurnState:{balanceBaseUnits:2n,supplyBaseUnits:2n,decimals:0,tokenAccounts:[]},parseTokenAmount:()=>1n,planTokenAccountBurns:()=>[],
      renderBuybackDashboard(){},updateFundedBurnButton(){},assertWalletSessionCurrent(){},PROTOCOL_FUNDED_MINT:'fixture-mint',
      getSolana:async()=>({PublicKey:class{},Transaction:class{}}),
      connection:{getLatestBlockhash:async()=>submitted?{blockhash:'fixture',lastValidBlockHeight:1}:failure(),
        sendRawTransaction:async()=>{sends++;return signature;}},waitForSignatureConfirmation:async()=>mode==='failed'?{value:{err:{InstructionError:[0,'fixture']}}}:failure()};
    await createFundedTradingController(state).submitFundedBurn();
    assert.doesNotMatch(state.fundedBurnState.message,/<|private-test-value/);
    assert.equal(sends,submitted?1:0);
    assert.match(state.fundedBurnState.message,mode==='failed'?new RegExp(`Burn failed on Solana: ${signature}`)
      :submitted?new RegExp(`uncertain for ${signature}`):/Burn verification is temporarily unavailable/);
  }
});
