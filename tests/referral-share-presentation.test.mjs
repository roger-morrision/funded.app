import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferralsController} from '../src/app/controllers/referrals.js';

test('referral sharing appears after activation and yields focus safely when the wallet changes',()=>{
  const previousDocument=globalThis.document,previousStorage=globalThis.localStorage,stored=new Map();
  const nodes=Object.fromEntries(['link','status','primary','share','code','help'].map(key=>[key,{textContent:'',hidden:false,focus(){globalThis.document.activeElement=this;}}]));
  const selectors={'#referral-link-status':nodes.status,'#referral-command-center [data-copy-referral-link]':nodes.primary,'#referral-share-help':nodes.help};
  globalThis.document={activeElement:null,querySelector:s=>selectors[s]||null,querySelectorAll:s=>s==='[data-referral-link]'?[nodes.link]:s==='#referral-share-native,#referral-copy-code'?[nodes.share,nodes.code]:[]};
  globalThis.localStorage={getItem:key=>stored.get(key)||null};
  let code='';const app={connectedWalletAddress:null,REFERRAL_SERVER_KEY_PREFIX:'fixture:',getReferralCode:()=>code,buildReferralUrl:value=>'https://example.test/?ref='+value};
  try{
    const view=createReferralsController(app);view.updateReferralLink();assert.equal(nodes.share.hidden,true);assert.equal(nodes.code.hidden,true);assert.equal(nodes.primary.textContent,'Get invite link');assert.equal(nodes.status.hidden,true);assert.equal(nodes.link.textContent,'Your link appears here');assert.match(nodes.help.textContent,/No transaction/);
    app.connectedWalletAddress='wallet-a';code='fixture-code';view.updateReferralLink();assert.equal(nodes.share.hidden,true);assert.match(nodes.help.textContent,/Approve a free sign-in message/);assert.doesNotMatch(nodes.help.textContent,/Connect your wallet/);assert.equal(nodes.status.hidden,false);
    stored.set('fixture:wallet-a',JSON.stringify({code}));view.updateReferralLink();assert.equal(nodes.share.hidden,false);assert.equal(nodes.code.hidden,false);assert.equal(nodes.primary.textContent,'Copy link');
    globalThis.document.activeElement=nodes.share;app.connectedWalletAddress=null;code='';view.updateReferralLink();assert.equal(nodes.share.hidden,true);assert.equal(globalThis.document.activeElement,nodes.primary);
  }finally{globalThis.document=previousDocument;globalThis.localStorage=previousStorage;}
});
