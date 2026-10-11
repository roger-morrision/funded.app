export const LEGACY_DEVNET_METADATA_ORIGIN = 'https://metadata.funded.vip';

// Only deployment configuration may choose the host. Never derive this from an
// upload or a request Host header. Local HTTP is useful for isolated previews.
export function normalizeDevnetMetadataOrigin(value = LEGACY_DEVNET_METADATA_ORIGIN) {
  const input = String(value).trim();
  let url;
  try { url = new URL(input); } catch { throw new Error('Devnet metadata origin must be an HTTPS origin.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /[\s\\]/.test(input) || !/^https?:\/\/[^/?#]+\/?$/i.test(input)) {
    throw new Error('Devnet metadata origin must be an HTTPS origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}

export const DEVNET_METADATA_ORIGIN = normalizeDevnetMetadataOrigin(import.meta.env?.VITE_DEVNET_METADATA_ORIGIN || LEGACY_DEVNET_METADATA_ORIGIN);

export function devnetMetadataUri(mint, origin = DEVNET_METADATA_ORIGIN) {
  return `${normalizeDevnetMetadataOrigin(origin)}/devnet-metadata/${mint}`;
}

export function devnetImageUri(mint, origin = DEVNET_METADATA_ORIGIN) {
  return `${normalizeDevnetMetadataOrigin(origin)}/devnet-images/${mint}`;
}

export function devnetBannerUri(mint, origin = DEVNET_METADATA_ORIGIN) {
  return `${normalizeDevnetMetadataOrigin(origin)}/devnet-banners/${mint}`;
}

export function isDevnetBannerUri(uri, mint) {
  return uri === devnetBannerUri(mint) || uri === devnetBannerUri(mint, LEGACY_DEVNET_METADATA_ORIGIN);
}

export function isDevnetImageUri(uri, mint) {
  return uri === devnetImageUri(mint) || uri === devnetImageUri(mint, LEGACY_DEVNET_METADATA_ORIGIN);
}

export function metadataStatement(record) {
  const fields = ['mint', 'creatorWallet', 'name', 'symbol', 'description', 'tagline', 'roadmap', 'website', 'x', 'telegram', 'discord', 'imageSha256'];
  if (record.bannerSha256) fields.push('bannerSha256');
  return `funded.vip Devnet metadata v${record.bannerSha256 ? '2' : '1'}\n${JSON.stringify(Object.fromEntries(fields.map(key => [key, record[key] || ''])))}`;
}
