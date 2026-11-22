import {readRichAssets,richAssetsAddress} from '../rich-assets.js';
import {PublicKey} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {requireSolanaCluster} from '../solana-network.js';
import {requireConfiguredDevnet} from './configured-devnet-interface.mjs';

export const V3_DEVNET_FUNDED_MINT=new PublicKey('C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64');
export const V3_DEVNET_FUNDED_POOL=new PublicKey('EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32');

// Mainnet assets come from the owner-controlled configuration. The independently
// reviewed binary and separate price signer remain mandatory.
export function buybackAssets(cluster='devnet',{programId,richAssets,configuredDevnet=null}={}){
  requireSolanaCluster(cluster);
  if(configuredDevnet)requireConfiguredDevnet(configuredDevnet,{cluster,programId});
  if(cluster==='devnet'&&!configuredDevnet)return{mint:V3_DEVNET_FUNDED_MINT,pool:V3_DEVNET_FUNDED_POOL};
  const release=reviewedMainnetManifest();
  if(!configuredDevnet&&(!release||release.assetConfiguration!=='onchain-v1'||!programId||new PublicKey(programId).toBase58()!==release.programId))
    throw new Error('Mainnet buybacks require the reviewed program, FUNDED mint and pool.');
  if(!richAssets||BigInt(richAssets.revision||0)<1n||![0,1].includes(richAssets.venue))throw Error('A finalized RICH configuration is required.');
  return{...richAssets,mint:new PublicKey(richAssets.mint),pool:new PublicKey(richAssets.pool),
    tokenProgram:new PublicKey(richAssets.tokenProgram),configAddress:richAssetsAddress(programId)};
}

export async function loadBuybackAssets(connection,cluster,programId){
  return buybackAssets(cluster,{programId,richAssets:cluster==='mainnet-beta'?await readRichAssets(connection,programId):null});
}
