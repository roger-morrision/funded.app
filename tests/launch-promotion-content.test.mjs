import test from 'node:test';
import assert from 'node:assert/strict';
import {promotionContentState} from '../src/features/launch/promotion-requirements.js';
import {prepareLaunchBanner,assertBannerReady} from '../launch-banner.js';
import {getLaunchStepState} from '../src/features/launch/form-validation.js';
import {createLaunchSubmitController} from '../src/app/controllers/launch-submit.js';
import {createLaunchReviewController} from '../src/app/controllers/launch-review.js';
import {launchReviewStillCurrent} from '../launch-review-gate.js';
import {launchReview} from '../launch-review.js';

const paid={tier:'pro',label:'Pro',requiresBurn:true};
function fixture(){
  const values={'token-name':'Example','token-symbol':'EX','token-description':'A community project.','token-roadmap':'Launch, build, expand.'};
  return {values,document:{querySelector:s=>({value:values[s.slice(1)]||''})}};
}

test('Standard keeps promotion content optional; paid content rejects whitespace and overlong text',()=>{
  const f=fixture();f.values['token-description']='   ';
  assert.equal(promotionContentState({requiresBurn:false},f).valid,true);
  assert.equal(promotionContentState(paid,f).field,'#token-description');
  f.values['token-description']='x'.repeat(281);
  assert.match(promotionContentState(paid,f).message,/280 characters/);
  f.values['token-description']='Description';f.values['token-roadmap']='\n ';
  assert.equal(promotionContentState(paid,f).field,'#token-roadmap');
  f.values['token-roadmap']='x'.repeat(421);
  assert.match(promotionContentState(paid,f).message,/420 characters/);
});

test('paid step one can continue before the step-two banner upload, while step two blocks',async()=>{
  await prepareLaunchBanner(null);const f=fixture();
  const services={...f,invalidLaunchSocial:()=>null,getFeeDistributionInputs:()=>({creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0}),getLaunchBurnPolicy:()=>paid};
  assert.equal(getLaunchStepState(1,{},services).valid,true);
  assert.equal(getLaunchStepState(2,{},services).field,'#token-banner');
  assert.throws(()=>assertBannerReady({required:true}),/Upload a token banner/);
});

test('pending and rejected banner preparation cannot satisfy a paid promotion',async()=>{
  const f=fixture(),original=globalThis.createImageBitmap;let reject;
  globalThis.createImageBitmap=()=>new Promise((_,r)=>{reject=r;});
  try{
    const preparation=prepareLaunchBanner(new File(['fixture'],'banner.png',{type:'image/png'}));
    const rejected=assert.rejects(preparation,/Unreadable image/);
    assert.match(promotionContentState(paid,f).message,/preparation to finish/);
    reject(new Error('Unreadable image'));await rejected;
    assert.match(promotionContentState(paid,f).message,/Unreadable image/);
    assert.equal(promotionContentState({requiresBurn:false},f).valid,true);
  }finally{globalThis.createImageBitmap=original;await prepareLaunchBanner(null);}
});

test('direct launch and metadata calls reject missing paid content before wallet requests',async()=>{
  const f=fixture(),original=globalThis.document;globalThis.document=f.document;
  let connects=0,signs=0,requests=0;const statuses=[];
  const app={APP_CLUSTER:'devnet',feeRouterState:{v3FeeRouter:{agency:{}}},getLaunchBurnPolicy:()=>paid,
    setLaunchStatus:m=>statuses.push(m),connectWallet:()=>connects++,apiRequest:()=>requests++};
  try{
    f.values['token-roadmap']=' ';
    await createLaunchSubmitController(app).launchToken();
    assert.match(statuses[0],/roadmap/);assert.equal(connects,0);
    await assert.rejects(createLaunchReviewController(app).prepareLaunchMetadata({mint:'fixture'}, {provider:{signMessage:()=>signs++}}),/roadmap/);
    assert.equal(signs,0);assert.equal(requests,0);
    f.values['token-roadmap']='Ready';
    await assert.rejects(createLaunchReviewController(app).prepareLaunchMetadata({mint:'fixture'}, {provider:{signMessage:()=>signs++}}),/Upload a token banner/);
    assert.equal(signs,0);
  }finally{globalThis.document=original;}
});

test('replacing or removing the reviewed banner invalidates launch confirmation',()=>{
  const banner={},current={reviewedCost:launchReview({balance:1e9,simulatedSpend:1e7,networkFee:5000,transactionCount:1}),wallet:'wallet',router:'router',form:'form',banner,feeConsent:true,termsConsent:true};
  assert.equal(launchReviewStillCurrent({...current},current),true);
  assert.equal(launchReviewStillCurrent({...current},{...current,banner:{}}),false);
  assert.equal(launchReviewStillCurrent({...current},{...current,banner:null}),false);
});
