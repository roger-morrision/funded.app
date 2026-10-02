import assert from 'node:assert/strict';
import test from 'node:test';
import { airdropClaimState } from '../airdrop-directory-model.js';

test('an open claim window does not claim distribution without receipts', () => {
  const now = 1_000;
  const open = airdropClaimState({ verified:true, status:'drop-active', expiresAt:2_000, claimedBaseUnits:'0' }, now);
  assert.deepEqual(open, { published:true, claimActive:true, status:'claiming', label:'Claims open · no receipts indexed' });
  const paid = airdropClaimState({ verified:true, status:'drop-active', expiresAt:2_000, claimedBaseUnits:'1' }, now);
  assert.equal(paid.label, 'Claims open · receipts indexed');
  const expired = airdropClaimState({ verified:true, status:'drop-active', expiresAt:1_000, claimedBaseUnits:'0' }, now);
  assert.deepEqual(expired, { published:true, claimActive:false, status:'closed', label:'Claims closed · no receipts indexed' });
  const unverified = airdropClaimState({ verified:false, status:'drop-active', expiresAt:2_000, claimedBaseUnits:'1' }, now);
  assert.deepEqual(unverified, { published:false, claimActive:false, status:'upcoming', label:'Claims pending' });
});
