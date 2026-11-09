import { PublicKey } from '@solana/web3.js';
import {deploymentCluster} from './network-write-policy.mjs';
import {financialProgramAllowed,financialRecordNetwork} from './financial-network.mjs';

const address = value => new PublicKey(String(value || '').trim()).toBase58();

export function communityProgramForLaunch(launch, env, v3AuthorityKeypair) {
  const cluster=deploymentCluster(env);
  if (launch?.pumpFeeRoute?.scope !== 'per-mint-v3')
    throw new Error('Community claims require a verified V3 launch.');
  const route = launch.pumpFeeRoute;
  const programId = address(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID);
  const authority = v3AuthorityKeypair?.()?.publicKey?.toBase58();
  const expectedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').toLowerCase();
  if (!launch.onchainVerified || !financialRecordNetwork(launch,cluster) || route.verified !== true || route.programId !== programId
    || !financialProgramAllowed(cluster,programId,expectedHash)
    || !authority || route.initialAuthority !== authority || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('Verified V3 community program, authority, and launch policy are required.');
  }
  // Switch together with the reviewed ProgramData hash after the router upgrade.
  // Older routers create the ATA internally and reject a pre-created account.
  const accountSetup = env.FUNDED_V3_COMMUNITY_ACCOUNT_SETUP || 'program';
  if (!['app', 'program'].includes(accountSetup)) throw new Error('Invalid community account setup mode.');
  return { cluster, programId, authority, expectedHash, accountSetup, scope:'per-mint-v3' };
}
