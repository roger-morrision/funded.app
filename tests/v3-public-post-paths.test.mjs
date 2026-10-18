import assert from 'node:assert/strict';
import test from 'node:test';
import { publicWalletSignedV3Post } from '../server/v3-public-post-paths.mjs';

const mint = '26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg';
const collection = '3q6PqX9UmX7nZZxZrAD8uemmN1UfvqNAHiURaE4L8veA6bN88AZfwi4CAEzVc4Pb4jdv5ma8387dTytzL464f6kM';

test('only exact wallet-signed V3 payout paths bypass the keeper token gate', () => {
  for (const action of ['settlement', 'community-funding', 'creator-reward-funding', 'creator-wallet-payout', 'operations-payout']) {
    assert.equal(publicWalletSignedV3Post(`/api/tokens/${mint}/v3-${action}/${collection}`), true, action);
  }
  for (const path of [
    `/api/tokens/${mint}/v3-settlement/${collection}/retry`,
    `/api/tokens/${mint}/v3-settlement/bad-signature`,
    `/api/tokens/bad-mint/v3-settlement/${collection}`,
    `/api/tokens/${mint}/v3-keeper-disbursement/${collection}`,
    `/api/keeper/reconcile-v3-settlement`,
  ]) assert.equal(publicWalletSignedV3Post(path), false, path);
});
