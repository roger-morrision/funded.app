import {reviewedMainnetManifest} from '../mainnet-program.js';
import {requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';

export function financialProgramAllowed(cluster,programId,hash){
  requireSolanaCluster(cluster);
  if(cluster==='devnet')return true;
  const release=reviewedMainnetManifest();
  return Boolean(release&&release.programId===programId&&release.programDataSha256===hash?.toLowerCase());
}

export function financialRecordNetwork(row,cluster,{legacyDevnet=false}={}){
  requireSolanaCluster(cluster);
  return Boolean(row&&(row.cluster===cluster||legacyDevnet&&cluster==='devnet'&&row.cluster==null)
    &&(row.genesisHash==null||row.genesisHash===SOLANA_GENESIS[cluster]));
}
