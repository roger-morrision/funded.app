import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationController } from '../src/app/controllers/navigation.js';
import { launchConfigurationBlocked, launchReadinessMessage } from '../src/features/launch/readiness-message.js';
import { createDailyBonusRuntime } from '../server/daily-bonus-runtime.mjs';
import { tickTodayBonus } from '../src/features/fees/bonus-today-view.js';
import { buildXPost } from '../server/x-post-content.mjs';
import bs58 from 'bs58';

test('direct Explore links honor subsequent menu destinations', () => {
  const prior = globalThis.location;
  try {
    globalThis.location = new URL('https://richpad.fun/explore');
    const navigation = createNavigationController({});
    assert.equal(navigation.requestedPageRoute(), 'explore');
    for (const [hash, page] of [['#launch','launch'],['#payments','payments'],['#overview','overview'],['#docs','docs']]) {
      globalThis.location.hash = hash;
      assert.equal(navigation.requestedPageRoute(), page);
    }
  } finally { if (prior === undefined) delete globalThis.location; else globalThis.location = prior; }
});

test('missing setup is distinguished from retryable RPC verification', () => {
  assert.equal(launchConfigurationBlocked({ready:false,programId:null,initialAuthority:null}), true);
  assert.equal(launchConfigurationBlocked({ready:false,programId:'configured',initialAuthority:'configured',reasons:['V3 launch registration is disabled']}), true);
  assert.equal(launchConfigurationBlocked({ready:false,programId:'configured',initialAuthority:'configured',reasons:['RPC timed out']}), false);
  assert.equal(launchConfigurationBlocked(null), false);
  assert.equal(launchConfigurationBlocked({ready:true}), false);
  assert.match(launchReadinessMessage({configurationBlocked:true}), /operator must finish server setup/);
  assert.doesNotMatch(launchReadinessMessage({configurationBlocked:true}), /Retry/);
});

test('disabled bonus service returns a typed configuration failure without starting a signer', async () => {
  const runtime = createDailyBonusRuntime({env:{},solanaCluster:'devnet',solanaRpcUrl:'https://api.devnet.solana.com',
    v3AuthorityKeypair:()=>{throw Error('Must not access a signer');}});
  let result;
  assert.equal(await runtime.handle({method:'GET'},{setHeader(){}},new URL('https://richpad.fun/api/daily-bonus/dashboard'),{
    respond:(_res,status,data)=>{result={status,data};}
  }), true);
  assert.equal(result.status,503);
  assert.equal(result.data.code,'BONUS_NOT_CONFIGURED');
});

test('unavailable bonus data does not invent a running payout countdown', () => {
  const clock={textContent:''};
  tickTodayBonus({querySelector:()=>clock},null,null,0);
  assert.equal(clock.textContent,'—:—:—');
});

test('promotional launch posts preserve proof checks and fit X limits for long names', () => {
  const proof={verified:true,commitment:'finalized',cluster:'devnet',slot:10,signature:bs58.encode(new Uint8Array(64).fill(3))};
  for (const marketingTier of ['standard','pro','premier']) for (const name of ['RICH CAT','龍'.repeat(100)+' @fake https://bad.example']) {
    const result=buildXPost('launch',{name,marketingTier,mint:'So11111111111111111111111111111111111111112',proofs:[proof]},{cluster:'devnet'});
    assert.match(result.text,/Explore the token/);
    assert.ok(result.weightedLength<=280 && result.byteLength<=280);
    assert.doesNotMatch(result.text,/@fake|https:\/\/bad/);
  }
  assert.throws(()=>buildXPost('launch',{name:'RICH CAT',marketingTier:'standard',mint:'So11111111111111111111111111111111111111112',proofs:[]},{cluster:'devnet'}),/proofs/);
});
