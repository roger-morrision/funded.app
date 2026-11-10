import test from 'node:test';
import assert from 'node:assert/strict';
import {launchPromotionPreview} from '../launch-promotion-copy.js';
import {xWeightedLength} from '../server/x-post-content.mjs';
const program={symbol:'RCAT',description:'A cat community.',creatorPercent:30,holderPercent:50,xPercent:0,airdropPercent:3,
  developerBuy:true,lockHours:12,tier:'pro',burnTokens:100000};
test('launch and migration drafts contain event header and saved promotion facts',()=>{
  for(const event of ['launch','migration']){
    const post=launchPromotionPreview('Rich Cat',{...program,event});
    assert(post.startsWith(event==='launch'?'New launch: $RCAT':'$RCAT is migrated'));
    for(const value of ['12h from launch','30% creator / 50% holders / 0% X','3% supply to eligible $RICH holders at migration','Pro | $RICH burn: 100,000'])assert(post.includes(value),value);
    assert(xWeightedLength(post)<=280);assert(!post.includes('airdrops paid'));
  }
});
test('no developer buy and unverified inputs never invent lock or reward amounts',()=>{
  const post=launchPromotionPreview('Cat',{...program,developerBuy:false,holderPercent:NaN,airdropPercent:100});
  assert(post.includes('Dev buy: none.'));assert(!post.includes('12h'));assert(post.includes('check allocation'));
  assert(!post.includes('NaN')&&!post.includes('100%'));
});
test('long descriptions and Unicode preserve allocation facts within X weighted limit',()=>{
  for(const description of ['Long description '.repeat(80),'猫のコミュニティ'.repeat(80)]){
    const post=launchPromotionPreview('Cat',{...program,symbol:'ABCDEFGHIJ',description,cluster:'devnet',airdropPercent:50,
      creatorPercent:33.3333,holderPercent:33.3333,xPercent:13.3334,tier:'premier',burnTokens:1234567890123});
    assert(xWeightedLength(post)<=280,post);assert(post.includes('[Devnet test]'));assert(post.includes('50% supply'));
    assert(post.includes('1,234,567,890,123'));assert(post.includes('12h from launch'));
  }
});
