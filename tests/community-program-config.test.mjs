import test from 'node:test';
import assert from 'node:assert/strict';
import { communityProgramForLaunch } from '../server/community-program-config.mjs';

const V2 = '61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa';
const V3 = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
const AUTHORITY = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
const env = { FUNDED_FEE_ROUTER_PROGRAM_ID:V2, FUNDED_REWARD_AUTHORITY:AUTHORITY,
  FUNDED_REWARD_PROGRAM_DATA_SHA256:'a'.repeat(64), FUNDED_V3_FEE_ROUTER_PROGRAM_ID:V3,
  FUNDED_V3_PROGRAM_DATA_SHA256:'b'.repeat(64) };
const signer = () => ({ publicKey:{ toBase58:() => AUTHORITY } });

test('V2 community claims cannot fall back to the retired program', () => {
  const launch = { onchainVerified:true, pumpFeeRoute:{ scope:'per-mint-v2', verified:true } };
  assert.throws(() => communityProgramForLaunch(launch, env, signer), /require a verified V3 launch/);
  assert.throws(() => communityProgramForLaunch(null, env, signer), /require a verified V3 launch/);
});

test('V3 community claims require the immutable launch program and configured authority', () => {
  const launch = { onchainVerified:true, cluster:'devnet', pumpFeeRoute:{ scope:'per-mint-v3', verified:true,
    programId:V3, initialAuthority:AUTHORITY } };
  assert.deepEqual(communityProgramForLaunch(launch, env, signer), {
    programId:V3, authority:AUTHORITY, expectedHash:'b'.repeat(64), scope:'per-mint-v3',
  });
  assert.throws(() => communityProgramForLaunch({ ...launch,
    pumpFeeRoute:{ ...launch.pumpFeeRoute, programId:V2 } }, env, signer), /Verified V3 community/);
  assert.throws(() => communityProgramForLaunch(launch, env, () => null), /Verified V3 community/);
  assert.throws(() => communityProgramForLaunch({ ...launch, onchainVerified:false }, env, signer), /Verified V3 community/);
  assert.throws(() => communityProgramForLaunch({ ...launch, cluster:'mainnet-beta' }, env, signer), /Verified V3 community/);
});
