import test from 'node:test';
import assert from 'node:assert/strict';
import { createRewardIdentityController } from '../src/app/controllers/reward-identity.js';

function fixture({ verify = { available:false, data:{ error:'Wallet signature rejected.' } },
  execute = { available:true, data:{ status:'paid', payment:{ finalized:true, balanceDeltaVerified:true } } } } = {}) {
  const button={ disabled:false }, status={ textContent:'' },
    id={ value:'collection-signature' }, agreement={ checked:true },
    row={ dataset:{ claimId:'collection-signature', mint:'mint-a', claimScope:'per-mint-v3' } };
  const elements={ '#sol-claim-submit':button, '#sol-claim-status':status,
    '#sol-claim-id':id, '#claim-binding-agree':agreement };
  const previousDocument=globalThis.document;
  globalThis.document={ querySelector:selector=>elements[selector],
    querySelectorAll:selector=>selector==='#sol-claim-list [data-claim-id]'?[row]:[] };
  const calls=[], session={ address:'recipient-a', provider:{
    signMessage:async () => ({ signature:new Uint8Array([1]) }) } };
  const controller=createRewardIdentityController({
    captureWalletSession:()=>session, assertWalletSessionCurrent:()=>{},
    bs58:{ encode:()=> 'signed-message' }, syncXClaimFlow:()=>{}, refreshXClaims:async()=>{},
    apiRequest:async path=>{
      calls.push(path);
      if (path.endsWith('/prepare')) return { available:true, data:{ statement:'challenge' } };
      if (path.endsWith('/verify')) return verify;
      if (path.endsWith('/execute')) return execute;
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  return { controller, calls, button, status,
    restore:()=>{ globalThis.document=previousDocument; } };
}

test('failed V3 X wallet verification never submits a payout', async () => {
  const f=fixture();
  try {
    await f.controller.submitV3XClaim();
    assert.deepEqual(f.calls.map(path=>path.split('/').at(-1)), ['prepare','verify']);
    assert.equal(f.status.textContent, 'Wallet signature rejected.');
    assert.equal(f.button.disabled, false);
  } finally { f.restore(); }
});

test('V3 X payout requires the verified wallet and finalized payment', async () => {
  for (const verify of [
    { available:true, data:{ status:'ready', wallet:'other-recipient' } },
    { available:true, data:{ status:'awaiting-wallet', wallet:'recipient-a' } },
  ]) {
    const f=fixture({ verify });
    try {
      await f.controller.submitV3XClaim();
      assert.equal(f.calls.length, 2);
      assert.match(f.status.textContent, /could not be verified/);
    } finally { f.restore(); }
  }
  const f=fixture({ verify:{ available:true, data:{ status:'ready', wallet:'recipient-a' } } });
  try {
    await f.controller.submitV3XClaim();
    assert.deepEqual(f.calls.map(path=>path.split('/').at(-1)), ['prepare','verify','execute']);
    assert.equal(f.status.textContent, 'V3 X payout finalized and verified.');
  } finally { f.restore(); }
});
