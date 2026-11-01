import test from 'node:test';
import assert from 'node:assert/strict';
import {createLaunchSubmitController} from '../src/app/controllers/launch-submit.js';
import {validateFeeDistribution} from '../distribution-policy.js';
import {validateLaunchBurnPolicy} from '../launch-burn-policy.js';

async function checkAccount(resolve, xPercent = 10) {
  const previous = globalThis.document, calls = [], statuses = [];
  const values = {'token-name':'Account check', 'token-symbol':'XQA', 'token-supply':'1000000000',
    'token-decimals':'6', 'x-recipient':'@example'};
  globalThis.document = {querySelector:s => ({value:values[s.slice(1)] || '', checked:true})};
  const wallet = {publicKey:{toBase58:()=> 'test-wallet'}, signTransaction(){assert.fail('No signing in this test');}};
  const session = {address:'test-wallet', provider:wallet};
  const app = {
    APP_CLUSTER:'devnet', wallet, xFeeStatus:{ready:false, reasons:['signal timed out']},
    feeRouterState:{verified:true, scope:'per-mint-v3', v3FeeRouter:{agency:{}}},
    MIN_COMMUNITY_AIRDROP_TOKENS:30000000, MAX_COMMUNITY_AIRDROP_TOKENS:500000000,
    walletBalanceLamports:1000000000, estimatedLaunchFeeLamports:10000000, launchCostReview:{},
    captureWalletSession:()=>session, canSignTransactions:()=>true,
    getLaunchMetadataPreview:()=>({}), getCommunityAirdropTokens:()=>30000000,
    getCommunityAllocationPercent:()=>3, normalizeXHandle:h=>h, getFundedMintAddress:()=>'',
    getLaunchBurnPolicy:()=>({tier:'standard', requiresBurn:false}), validateLaunchBurnPolicy,
    getFeeDistributionInputs:()=>({creatorWalletPercent:80-xPercent, holderAirdropPercent:0, solClaimPercent:xPercent, xRecipient:'@example'}),
    validateFeeDistribution, invalidLaunchSocial:()=>null, freshLaunchReview:()=>true,
    setLaunchStatus:m=>statuses.push(m), assertWalletSessionCurrent(){},
    getAppReferralAttribution:()=>null, getCreatorBuySol:()=>0, readLaunchJournal:()=>[],
    isWalletSessionCurrent:()=>true, pilotInterruptedSignal:()=> 'launch-failed', emitPilotSignal(){}, updateLaunchButton(){},
    apiRequest:async path=>{calls.push(path);if(path.startsWith('/api/x/resolve?'))return resolve();
      assert.equal(path,'/api/v3-launch-config');throw new Error('Test stopped after account check, before any transaction');},
  };
  try {await createLaunchSubmitController(app).launchToken();return {calls,statuses};}
  finally {globalThis.document=previous;}
}

test('a found X account proceeds past lookup despite an unavailable global reward service', async () => {
  const result = await checkAccount(()=>({available:true,data:{id:'12345',handle:'@Example'}}));
  assert.deepEqual(result.calls,['/api/x/resolve?handle=%40example','/api/v3-launch-config']);
  assert.match(result.statuses.at(-1),/Test stopped after account check/);
});

test('a nonexistent X account stops before any transaction preparation', async () => {
  const result = await checkAccount(()=>{throw Object.assign(new Error('X account @example was not found.'),{status:404});});
  assert.deepEqual(result.calls,['/api/x/resolve?handle=%40example']);
  assert.match(result.statuses.at(-1),/X account @example was not found/);
});

test('an inconclusive lookup or mismatched identity is never treated as a nonexistent or verified account', async () => {
  for(const resolve of [()=>{throw Object.assign(new Error('X account lookup timed out. Retry shortly.'),{status:503});},
    ()=>({available:true,data:{id:'12345',handle:'@other'}}),()=>({available:true,data:{id:'12345'}})]) {
    const result=await checkAccount(resolve);
    assert.deepEqual(result.calls,['/api/x/resolve?handle=%40example']);
    assert.match(result.statuses.at(-1),/timed out|could not be checked/);
    assert.doesNotMatch(result.statuses.at(-1),/was not found/);
  }
});

test('a launch with no X reward allocation needs no account lookup', async () => {
  const result=await checkAccount(()=>assert.fail('Unexpected X lookup'),0);
  assert.deepEqual(result.calls,['/api/v3-launch-config']);
});
