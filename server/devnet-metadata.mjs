import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { devnetImageUri, metadataStatement } from '../devnet-metadata.js';

export const MAX_METADATA_IMAGE_BYTES = 600_000;

function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} is invalid or too long.`);
  return value.trim();
}

function link(value, max, label, hosts = null) {
  const raw = text(value || '', max, label);
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (hosts && !hosts.includes(parsed.hostname.toLowerCase()))) throw new Error(`${label} must be a valid HTTPS URL.`);
  return parsed.href;
}

function imageMime(bytes, declared) {
  if (declared === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return declared;
  if (declared === 'image/jpeg' && bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return declared;
  if (declared === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return declared;
  throw new Error('Image bytes do not match a supported PNG, JPG, or WEBP file.');
}

export function parseSignedMetadata(input) {
  const mint = new PublicKey(String(input.mint || '')).toBase58();
  const creatorWallet = new PublicKey(String(input.creatorWallet || '')).toBase58();
  const name = text(input.name, 32, 'Token name');
  const symbol = text(input.symbol, 10, 'Ticker');
  if (!name || !/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error('Token name or ticker is invalid.');
  const imageBase64 = input.imageBase64 || '';
  if (typeof imageBase64 !== 'string' || imageBase64.length > Math.ceil(MAX_METADATA_IMAGE_BYTES / 3) * 4 || (imageBase64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))) throw new Error('Image must be a PNG, JPG, or WEBP under 600 KB.');
  const image = imageBase64 ? Buffer.from(imageBase64, 'base64') : null;
  if (image && (image.length > MAX_METADATA_IMAGE_BYTES || image.toString('base64') !== imageBase64)) throw new Error('Image encoding is invalid or too large.');
  const imageType = image ? imageMime(image, input.imageType) : null;
  const imageSha256 = image ? createHash('sha256').update(image).digest('hex') : '';
  if (String(input.imageSha256 || '') !== imageSha256) throw new Error('Image checksum does not match the signed metadata.');
  const record = {
    mint, creatorWallet, name, symbol,
    description: text(input.description || '', 280, 'Description'),
    tagline: text(input.tagline || '', 90, 'Tagline'),
    roadmap: text(input.roadmap || '', 420, 'Roadmap'),
    website: link(input.website, 300, 'Website'),
    x: link(input.x, 300, 'X link', ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']),
    telegram: link(input.telegram, 300, 'Telegram link', ['t.me', 'telegram.me']),
    discord: link(input.discord, 300, 'Discord link', ['discord.gg', 'discord.com', 'www.discord.com']),
    imageSha256,
  };
  let signature;
  try { signature = bs58.decode(String(input.signature || '')); } catch { throw new Error('Metadata wallet signature is invalid.'); }
  if (!nacl.sign.detached.verify(new TextEncoder().encode(metadataStatement(record)), signature, new PublicKey(creatorWallet).toBytes())) throw new Error('Metadata wallet signature is invalid.');
  return { record, image, imageType };
}

export function publicMetadata(record) {
  return {
    name: record.name,
    symbol: record.symbol,
    description: record.description || 'Devnet test token launched on funded.vip. Devnet assets have no intended monetary value.',
    image: record.imageSha256 ? devnetImageUri(record.mint) : 'https://metadata.funded.vip/default.svg',
    ...(record.website ? { external_url: record.website, website: record.website } : {}),
    ...(record.x ? { twitter: record.x } : {}),
    ...(record.telegram ? { telegram: record.telegram } : {}),
    ...(record.discord ? { discord: record.discord } : {}),
    ...(record.tagline ? { tagline: record.tagline } : {}),
    ...(record.roadmap ? { roadmap: record.roadmap } : {}),
  };
}
