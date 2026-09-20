export const DEVNET_METADATA_ORIGIN = 'https://metadata.funded.vip';

export function devnetMetadataUri(mint) {
  return `${DEVNET_METADATA_ORIGIN}/devnet-metadata/${mint}`;
}

export function devnetImageUri(mint) {
  return `${DEVNET_METADATA_ORIGIN}/devnet-images/${mint}`;
}

export function metadataStatement(record) {
  const fields = ['mint', 'creatorWallet', 'name', 'symbol', 'description', 'tagline', 'roadmap', 'website', 'x', 'telegram', 'discord', 'imageSha256'];
  return `funded.vip Devnet metadata v1\n${JSON.stringify(Object.fromEntries(fields.map(key => [key, record[key] || ''])))}`;
}
