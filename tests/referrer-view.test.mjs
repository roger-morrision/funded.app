import test from 'node:test';
import assert from 'node:assert/strict';
import {referrerMarkup, renderReferrer} from '../src/features/referrals/referrer-view.js';

test('referral absence, sign-in and failures remain visible and distinct',()=>{
  assert.match(referrerMarkup(null,'disconnected'),/Connect your wallet/);
  assert.match(referrerMarkup(null,'verification'),/Sign in with your wallet/);
  assert.match(referrerMarkup(null,'checking'),/Checking/);
  assert.match(referrerMarkup(null,'unavailable'),/unavailable/);
  assert.match(referrerMarkup(null,'ready'),/No referrer is recorded/);
  assert.match(referrerMarkup(undefined,'ready'),/unavailable/);
});
test('verified referrer links to the wallet and escapes its code',()=>{
  const wallet='ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
  const markup=referrerMarkup({wallet,code:'<script>unsafe</script>',since:'2026-11-22T00:00:00Z'});
  assert.ok(markup.includes(`href="/wallet/${wallet}"`));
  assert.ok(markup.includes('ER7z…FzXC'));
  assert.ok(markup.includes('&lt;script&gt;'));assert.ok(!markup.includes('<script>'));
});
test('wallet reset clears the previous referrer instead of hiding the section',()=>{
  const node={hidden:true},value={innerHTML:'old-wallet'};
  renderReferrer(null,'disconnected',{querySelector:key=>key==='#referral-referrer'?node:value});
  assert.equal(node.hidden,false);assert.match(value.innerHTML,/Connect your wallet/);
  assert.ok(!value.innerHTML.includes('old-wallet'));
});
