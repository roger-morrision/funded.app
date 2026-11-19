import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseServices, servicesFor } from '../scripts/verify-deployment-readiness.mjs';

test('release services add the internal and price signers only when a release defines them', () => {
  assert.deepEqual(servicesFor({ services:{} }), releaseServices);
  assert.deepEqual(servicesFor({ services:{ signer:{} } }), [...releaseServices, 'signer']);
  assert.deepEqual(servicesFor({ services:{ signer:{}, 'price-signer':{} } }), [...releaseServices, 'signer', 'price-signer']);
  assert.deepEqual(servicesFor(undefined), releaseServices);
});
