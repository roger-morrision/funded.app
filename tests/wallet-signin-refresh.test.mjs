import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferralsController} from '../src/app/controllers/referrals.js';

test('successful wallet sign-in refreshes saved data once per wallet session',async()=>{
  const originalWindow=globalThis.window;const events=[];let restores=0;
  globalThis.window={dispatchEvent:event=>events.push(event.type)};
  try{
    const app={walletSignIn:{ensure:async()=>true},assertWalletSessionCurrent(){},restoreWalletFavorites:async()=>{restores++;},updateTokenChatComposerState(){}};
    const controller=createReferralsController(app);
    await controller.ensureReferralSession({address:'wallet-a',version:1});
    await controller.ensureReferralSession({address:'wallet-a',version:1});
    assert.equal(restores,1);assert.deepEqual(events,['funded:wallet-authenticated']);
    await controller.ensureReferralSession({address:'wallet-b',version:2});
    assert.equal(restores,2);
    app.assertWalletSessionCurrent=()=>{throw Error('wallet changed');};
    await assert.rejects(controller.ensureReferralSession({address:'wallet-a',version:1}),/wallet changed/);
    assert.equal(restores,2,'stale sign-in must not refresh the wrong account');
  }finally{globalThis.window=originalWindow;}
});
