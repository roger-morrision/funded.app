import test from 'node:test';
import assert from 'node:assert/strict';
import {launchPromotionPreview} from '../launch-promotion-copy.js';
import {xWeightedLength} from '../server/x-post-content.mjs';

const program = {description:'A community-powered cat token on Solana.',holderPercent:10,xPercent:0,airdropPercent:3};

test('preview includes the entered name, description and configured programs',()=>{
  const post=launchPromotionPreview('RICH CAT',program);
  assert.match(post,/^RICH CAT\nA community-powered cat token on Solana\./);
  assert.match(post,/SOL rewards: 10% to holders\./);
  assert.match(post,/Airdrop: 3% of supply to eligible \$RICH holders at migration\./);
  assert.match(post,/Join the community\. Discover your rewards/);
  assert.ok(xWeightedLength(post)<=280);
});

test('changed allocations and follow-up previews reflect the same draft',()=>{
  const post=launchPromotionPreview('RICH CAT',{...program,holderPercent:20,xPercent:5,xHandle:'@savipww',airdropPercent:5,followup:true});
  assert.match(post,/RICH CAT · Follow-up/);
  assert.match(post,/20% to holders; 5% to @savipww/);
  assert.match(post,/Airdrop: 5% of supply/);
  assert.match(post,/A community-powered cat token/);
  assert.doesNotMatch(post,/10%|Airdrop: 3%/);
});

test('disabled holder rewards and missing input never invent reward amounts',()=>{
  const off=launchPromotionPreview('RICH CAT',{...program,description:'',holderPercent:0});
  assert.match(off,/Holder SOL rewards: off/);
  assert.doesNotMatch(off,/community-powered|10% to holders/);
  const invalid=launchPromotionPreview('RICH CAT',{holderPercent:NaN,airdropPercent:100});
  assert.match(invalid,/check fee allocation/);
  assert.match(invalid,/check allocation/);
  assert.doesNotMatch(invalid,/NaN%|100%/);
});

test('long descriptions fit X limits without removing program terms',()=>{
  for(const description of ['A long token description '.repeat(30),'猫のコミュニティ'.repeat(60)]) {
    const post=launchPromotionPreview('A'.repeat(32),{...program,description,xPercent:10,xHandle:'@abcdefghijklmn',airdropPercent:50,followup:true});
    assert.ok(xWeightedLength(post)<=280);
    assert.match(post,/…\nSOL rewards/);
    assert.match(post,/10% to holders; 10% to @abcdefghijklmn/);
    assert.match(post,/Airdrop: 50% of supply to eligible \$RICH holders at migration/);
    assert.match(post,/Join the community\. Discover your rewards/);
  }
});
