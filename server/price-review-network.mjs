import assert from 'node:assert/strict';
import {requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {requireConfiguredDevnet} from './configured-devnet-interface.mjs';

// Network-aware review is reusable without granting a signing capability.
// The HTTP signing service and its launcher remain Devnet-only.
export function priceReviewNetwork(config,request,{release=reviewedMainnetManifest(),configuredDevnet=null}={}) {
  const cluster=requireSolanaCluster(config.cluster||'devnet');
  assert(request?.cluster===cluster&&request.programId===config.programId,'Unapproved network or program.');
  if(configuredDevnet)requireConfiguredDevnet(configuredDevnet,{cluster,programId:config.programId,
    programDataSha256:config.programDataSha256,upgradeAuthority:config.upgradeAuthority});
  if(cluster==='mainnet-beta') {
    const approved=reviewedMainnetManifest(release);
    assert(approved&&approved.programId===config.programId&&approved.programDataSha256===config.programDataSha256
      &&approved.upgradeAuthority===config.upgradeAuthority&&approved.assetConfiguration==='onchain-v1'
      &&config.assetConfiguration==='onchain-v1','Mainnet price review requires the exact independently reviewed release and assets.');
  }
  return {cluster,genesisHash:SOLANA_GENESIS[cluster],...(configuredDevnet?{configured:true,contextHash:configuredDevnet.contextHash}:{})};
}
