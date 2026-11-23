import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeSitePlan } from '../../scripts/mainnet-nonprogram-site-plan.mjs';

const current = {
  project: 'richpad-mainnet', revision: 'd5cf43d6c926f8945e1ed06e1d89019e0f432366',
  image: `sha256:${'a'.repeat(64)}`, composeSha256: 'b'.repeat(64),
  genesis: 'MainnetGenesisIdentityLongEnough', cluster: 'mainnet-beta', activation: false,
  programId: '', fundedPool: '', fundedMint: 'Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr',
  tradeFeeRecipient: 'M1HfA8vPXwGGn8uv5p9BZSYjsh4jhxhoMfDx2sGsj4M', tradeFeeBps: '100',
  services: ['app', 'rpc-gateway', 'db', 'rpc-cache', 'https'],
  dependencies: { db: `sha256:${'c'.repeat(64)}`, 'rpc-cache': `sha256:${'d'.repeat(64)}`, https: `sha256:${'e'.repeat(64)}` },
  policy: {
    FUNDED_MAINNET_NON_PROGRAM_WRITES: 'true', FUNDED_MINT_FEE_ROUTER_ENABLED: 'false',
    FUNDED_BUYBACK_EXECUTOR_ENABLED: 'false', FUNDED_DAILY_BONUS_ENABLED: 'false',
    FUNDED_DAILY_BONUS_PAYOUT_ENABLED: 'false', FUNDED_LAUNCH_POST_EMAIL_ENABLED: 'true',
    FUNDED_API_ONLY: 'false', VITE_ALLOW_MAINNET: 'true', SOLANA_CLUSTER: 'mainnet-beta',
    VITE_SOLANA_CLUSTER: 'mainnet-beta', FUNDED_TOKEN_MINT: 'Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr',
    VITE_FUNDED_TOKEN_MINT: 'Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr', FUNDED_TRADE_FEE_BPS: '100',
  },
};
const candidate = {
  ...structuredClone(current), revision: 'f'.repeat(40), image: `sha256:${'1'.repeat(64)}`,
  composeSha256: '2'.repeat(64), frontendSha256: '3'.repeat(64), changedServices: ['app', 'rpc-gateway'],
};
const plan = (change) => makeSitePlan({ current, candidate: { ...structuredClone(candidate), ...change } });

test('produces a non-executable site-only plan', () => {
  const result = plan({});
  assert.equal(result.executable, false);
  assert.deepEqual(result.allowedSwitchServices, ['app', 'rpc-gateway']);
  assert.deepEqual(result.retainedServices, ['db', 'rpc-cache', 'https']);
});
test('refuses activation and program identity', () => {
  assert.throws(() => plan({ activation: true }), /activation/);
  assert.throws(() => plan({ programId: 'ExUNA' }), /router program/);
});
test('refuses mint, fee recipient and policy changes', () => {
  assert.throws(() => plan({ fundedMint: '7R4' }), /mint changed/);
  assert.throws(() => plan({ tradeFeeRecipient: 'other' }), /recipient changed/);
  const changed = structuredClone(candidate.policy); changed.FUNDED_MINT_FEE_ROUTER_ENABLED = 'true';
  assert.throws(() => plan({ policy: changed }), /FEE_ROUTER/);
});
test('refuses dependency or service changes', () => {
  assert.throws(() => plan({ changedServices: ['app', 'db'] }), /only app/);
  assert.throws(() => plan({ dependencies: { ...candidate.dependencies, db: `sha256:${'9'.repeat(64)}` } }), /db image changed/);
});
test('requires complete immutable candidate identities', () => {
  assert.throws(() => plan({ image: 'richpad-mainnet:latest' }), /image digest/);
  assert.throws(() => plan({ composeSha256: current.composeSha256 }), /new reviewed digest/);
  assert.throws(() => plan({ frontendSha256: '' }), /frontend SHA/);
});
