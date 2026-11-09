import assert from 'node:assert/strict';
import {requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';

// Network-aware review is reusable without granting a signing capability.
// The HTTP signing service and its launcher remain Devnet-only.
export function priceReviewNetwork(config,request,{release=reviewedMainnetManifest()}={}) {
  const cluster=requireSolanaCluster(config.cluster||'devnet');
  assert(request?.cluster===cluster&&request.programId===config.programId,'Unapproved network or program.');
  if(cluster==='mainnet-beta') {
    const approved=reviewedMainnetManifest(release);
    assert(approved&&approved.programId===config.programId&&approved.programDataSha256===config.programDataSha256
      &&approved.upgradeAuthority===config.upgradeAuthority&&approved.fundedMint===config.mint
      &&approved.fundedPool===config.pool,'Mainnet price review requires the exact independently reviewed release and assets.');
  }
  return {cluster,genesisHash:SOLANA_GENESIS[cluster]};
}
