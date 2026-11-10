import test from 'node:test';
import assert from 'node:assert/strict';
import {communityLink} from '../community-link.js';
import {createCommunityNameReader,telegramTitle} from '../server/community-names.mjs';
test('community links resolve only fixed public providers and keep private invite fallback honest',()=>{
  assert.equal(communityLink('https://t.me/richpad','telegram').fallback,'@richpad');
  assert.equal(communityLink('https://discord.com/invite/abc123','discord').fallback,'Discord invite · abc123');
  for(const url of ['http://t.me/richpad','https://t.me.evil.test/richpad','https://x@t.me/richpad','https://t.me:444/richpad'])assert.equal(communityLink(url,'telegram'),null);
  assert.equal(telegramTitle('<meta property="og:title" content="RICH &amp; friends">'),'RICH & friends');
  assert.equal(telegramTitle('<meta property="og:title" content="Telegram: Contact @richpad">'),null);
});
test('name lookup caches and uses public Discord guild/channel names without redirects or credentials',async()=>{
  let calls=0;const read=createCommunityNameReader({fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://discord.com/api/v10/invites/abc123');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);return new Response(JSON.stringify({guild:{name:'RICH community'},channel:{name:'general'}}));}});
  assert.equal(await read('https://discord.gg/abc123','discord'),'RICH community · #general');
  assert.equal(await read('https://discord.gg/abc123','discord'),'RICH community · #general');assert.equal(calls,1);
  assert.equal(await read('https://127.0.0.1/a','discord'),null);
});
