import {SharedRpcConnection} from './rpc-connection.mjs';
import {communityProgramForLaunch} from './community-program-config.mjs';
import {createCommunityClaimService} from './community-claim-service.mjs';

export function createCommunityClaimRuntime({store,automaticRewardStore,solanaCluster,solanaRpcUrl,
  getPrimaryRich,v3AuthorityKeypair,env=process.env}) {
  return async function communityClaimService(mint) {
    if (solanaCluster !== 'devnet') throw new Error('Solana community claim configuration is unavailable.');
    const saved=(await automaticRewardStore.read()).communityDrops?.[mint];
    const eligibilityMint=saved?.eligibilityMint||(await getPrimaryRich()).fundedMint;
    const config=communityProgramForLaunch(await store.readLaunch(mint),env,v3AuthorityKeypair);
    return createCommunityClaimService({connection:new SharedRpcConnection(solanaRpcUrl,'finalized'),store:automaticRewardStore,
      programId:config.programId,authority:config.authority,eligibilityMint,cluster:solanaCluster,
      expectedCommunityProgramDataSha256:config.expectedHash,accountSetup:config.accountSetup,
      qaCutoffMint:env.FUNDED_QA_COMMUNITY_CUTOFF_ENABLED==='true'
        ?[env.FUNDED_QA_COMMUNITY_MINT,env.FUNDED_QA_COMMUNITY_MINTS].filter(Boolean).join(','):'',
      qaCutoffAuthority:env.FUNDED_QA_COMMUNITY_CUTOFF_AUTHORITY||''});
  };
}
