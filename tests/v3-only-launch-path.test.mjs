import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLaunchMintRouter, submitPumpDevnetLaunch } from '../launch-flow.js';
import { buildMintRouterInitializeInstruction } from '../mint-router-launch.js';

test('a V2 or shared-router launch fails before wallet or network access', async () => {
  const noAccess = new Proxy({}, { get: () => assert.fail('A retired launch touched wallet or RPC') });
  assert.throws(() => buildMintRouterInitializeInstruction(), /V2 mint-router initialization is retired/);
  assert.throws(() => buildLaunchMintRouter({ feeRouterProgramId:'retired-v2' }), /approved V3 program/);
  await assert.rejects(submitPumpDevnetLaunch({ cluster:'devnet', connection:noAccess,
    provider:noAccess, payer:noAccess, input:noAccess, feeRouterProgramId:'retired-v2',
    useMintRouter:true }), /Only verified V3 mint-router launches/);
  await assert.rejects(submitPumpDevnetLaunch({ cluster:'devnet', connection:noAccess,
    provider:noAccess, payer:noAccess, input:noAccess,
    v3FeeRouter:{ programId:'v3', initialAuthority:'authority', split:{} } }),
  /Only verified V3 mint-router launches/);
});
