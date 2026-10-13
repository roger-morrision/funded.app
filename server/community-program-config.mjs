import { PublicKey } from '@solana/web3.js';

const address = value => new PublicKey(String(value || '').trim()).toBase58();

export function communityProgramForLaunch(launch, env, v3AuthorityKeypair) {
  if (launch?.pumpFeeRoute?.scope !== 'per-mint-v3')
    throw new Error('Community claims require a verified V3 launch.');
  const route = launch.pumpFeeRoute;
  const programId = address(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID);
  const authority = v3AuthorityKeypair?.()?.publicKey?.toBase58();
  const expectedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').toLowerCase();
  if (!launch.onchainVerified || launch.cluster !== 'devnet' || route.verified !== true || route.programId !== programId
    || !authority || route.initialAuthority !== authority || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('Verified V3 community program, authority, and launch policy are required.');
  }
  return { programId, authority, expectedHash, scope:'per-mint-v3' };
}
