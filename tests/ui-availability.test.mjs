import test from 'node:test';
import assert from 'node:assert/strict';
import {fundedBuyFailureMessage} from '../src/features/funded/buy-feedback.js';
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
