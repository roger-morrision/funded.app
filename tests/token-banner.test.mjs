import test from 'node:test';
import assert from 'node:assert/strict';
import { devnetBannerUri } from '../devnet-metadata.js';
import { verifiedTokenBannerUri } from '../src/features/coin/token-banner.js';

const mint = '11111111111111111111111111111111';
const signature = 'verified-launch-signature';
const paid = {
  mint, onchainVerified: true, signature, bannerUri: devnetBannerUri(mint),
  creatorLaunchBurn: { tier: 'pro', status: 'verified', amountTokens: 100_000,
    receipt: { verified: true, atomicWithPumpLaunch: true, signature } },
};

test('token banner requires a verified paid launch and a trusted mint URL', () => {
  assert.equal(verifiedTokenBannerUri(paid, mint), paid.bannerUri);
  assert.equal(verifiedTokenBannerUri({ ...paid, creatorLaunchBurn: { ...paid.creatorLaunchBurn, tier: 'premier' } }, mint), paid.bannerUri);
  assert.equal(verifiedTokenBannerUri({ ...paid, creatorLaunchBurn: undefined }, mint), '');
  assert.equal(verifiedTokenBannerUri({ ...paid, onchainVerified: false }, mint), '');
  assert.equal(verifiedTokenBannerUri({ ...paid, creatorLaunchBurn: { ...paid.creatorLaunchBurn, receipt: { ...paid.creatorLaunchBurn.receipt, verified: false } } }, mint), '');
  assert.equal(verifiedTokenBannerUri({ ...paid, bannerUri: 'https://attacker.example/banner.png' }, mint), '');
  assert.equal(verifiedTokenBannerUri(paid, '22222222222222222222222222222222'), '');
});
