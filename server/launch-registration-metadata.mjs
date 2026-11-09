import {devnetMetadataUri,devnetLaunchMetadataUri} from '../devnet-metadata.js';
import {isPinnedMetadataUri,onchainMetadataUri} from '../metadata-publication.js';
import {metadataRecordOrigin} from './devnet-metadata.mjs';
import {verifyPublishedMetadata} from './metadata-publication.mjs';
import {financialRecordNetwork} from './financial-network.mjs';
import {requireSolanaCluster} from '../solana-network.js';

// Registration must bind the metadata that was signed to the actual creation
// receipt. Mainnet may never fall back to mutable Devnet URLs or missing data.
export async function registeredLaunchMetadata({proof,record,inputUri,cluster,verifyPublication=verifyPublishedMetadata}) {
  requireSolanaCluster(cluster);
  if (!financialRecordNetwork(proof,cluster)) throw Error('Launch proof belongs to another network.');
  if (record && !financialRecordNetwork(record,cluster,{legacyDevnet:true}))
    throw Error('Signed metadata belongs to another network.');
  const pinned=record?.pinnedMetadata?.uri;
  if (cluster==='mainnet-beta' && (!record || !isPinnedMetadataUri(pinned)))
    throw Error('Mainnet launch registration requires signed durable metadata.');
  const uri=pinned ? (proof.uri===pinned ? pinned : onchainMetadataUri(pinned))
    : proof.uri===devnetLaunchMetadataUri(proof.mint) ? proof.uri
      : devnetMetadataUri(proof.mint,metadataRecordOrigin(record));
  if (inputUri && inputUri!==uri) throw Error('Launch metadata URL does not match the mint.');
  if (inputUri && !record) throw Error('Signed token metadata is missing.');
  if (record && (record.mint!==proof.mint || record.creatorWallet!==proof.feePayer
    ||record.name!==proof.name || record.symbol!==proof.symbol || proof.uri!==uri))
    throw Error('Signed metadata does not match the confirmed Pump launch.');
  if (cluster==='mainnet-beta') {
    const published=await verifyPublication(record);
    if (published?.verified!==true || published.uri!==pinned)
      throw Error('Durable launch metadata could not be verified.');
  }
  return uri;
}
