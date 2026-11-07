// Fixed public gateway: uploads cannot choose a browser/server fetch destination.
import {requireSolanaCluster,SOLANA_GENESIS} from './solana-network.js';
export const PINATA_PUBLIC_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
export const validMetadataCid = cid => typeof cid === 'string' && /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,119})$/.test(cid);
export const pinnedMetadataUri = cid => {
  if (!validMetadataCid(cid)) throw new Error('Invalid public metadata CID.');
  return PINATA_PUBLIC_GATEWAY + cid;
};
export const isPinnedMetadataUri = uri => typeof uri === 'string' && uri.startsWith(PINATA_PUBLIC_GATEWAY)
  && validMetadataCid(uri.slice(PINATA_PUBLIC_GATEWAY.length));

// Keep the content address on-chain; verify availability through the HTTPS gateway.
export const onchainMetadataUri = uri => isPinnedMetadataUri(uri)
  ? `ipfs://${uri.slice(PINATA_PUBLIC_GATEWAY.length)}` : uri;

export function assertMetadataPublication(data, expectedUri, now = Date.now(), cluster='devnet') {
  requireSolanaCluster(cluster);
  if ((cluster==='mainnet-beta'&&(data?.cluster!==cluster||data?.genesisHash!==SOLANA_GENESIS[cluster]||!isPinnedMetadataUri(expectedUri)))
    ||data?.cluster!=null&&data.cluster!==cluster||data?.genesisHash!=null&&data.genesisHash!==SOLANA_GENESIS[cluster])
    throw new Error('Metadata publication does not match the selected network. No token transaction was sent.');
  const proof = data?.publication;
  const checkedAt = Date.parse(proof?.checkedAt);
  if (proof?.verified !== true || proof.uri !== expectedUri || proof.image !== data.image
    || typeof data.image !== 'string' || !data.image.startsWith('https://')
    || !['hosted-devnet', 'pinata'].includes(proof.storage)
    || (isPinnedMetadataUri(expectedUri) && proof.storage !== 'pinata')
    || (proof.storage === 'pinata' && (!isPinnedMetadataUri(proof.uri) || !isPinnedMetadataUri(proof.image)))
    || !Number.isFinite(checkedAt) || Math.abs(now - checkedAt) > 120_000)
    throw new Error('Public token metadata and image could not be verified. No token transaction was sent.');
}
