import {PublicKey} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {requireSolanaCluster} from '../solana-network.js';

export const V3_DEVNET_FUNDED_MINT=new PublicKey('C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64');
export const V3_DEVNET_FUNDED_POOL=new PublicKey('EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32');

// Production assets are part of the reviewed bytecode identity, not request
// fields or mutable environment overrides. Placeholders always fail closed.
export function buybackAssets(cluster='devnet',{programId}={}){
  requireSolanaCluster(cluster);
  if(cluster==='devnet')return{mint:V3_DEVNET_FUNDED_MINT,pool:V3_DEVNET_FUNDED_POOL};
  const release=reviewedMainnetManifest();
  if(!release||!programId||new PublicKey(programId).toBase58()!==release.programId)
    throw new Error('Mainnet buybacks require the reviewed program, FUNDED mint and pool.');
  return{mint:new PublicKey(release.fundedMint),pool:new PublicKey(release.fundedPool)};
}
