import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {publicMetadata} from './devnet-metadata.mjs';
import {devnetLaunchMetadataUri} from '../devnet-metadata.js';
import {pinnedMetadataUri} from '../metadata-publication.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fallbackImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#111827"/><text x="128" y="160" text-anchor="middle" font-family="sans-serif" font-size="100" fill="#d7b65d">F</text></svg>');

// Bounded reads, no redirects, no cookies, and no upstream error bodies in UI.
async function publicBytes(fetchImpl, uri, mime, maxBytes) {
  const response = await fetchImpl(uri, {redirect:'error', credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(12_000)});
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith(mime))
    throw new Error('Public metadata or image is not available in the expected format.');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Public metadata or image exceeds its size limit.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('Public metadata or image exceeds its size limit.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  if (!size) throw new Error('Public metadata or image is empty.');
  return Buffer.concat(chunks);
}

export async function verifyPublishedMetadata(record, {fetchImpl = fetch} = {}) {
  const expected = publicMetadata(record);
  const uri = record.pinnedMetadata?.uri || devnetLaunchMetadataUri(record.mint);
  try {
    const metadata = await publicBytes(fetchImpl, uri, 'application/json', 32_000);
    if (!isDeepStrictEqual(JSON.parse(metadata.toString()), expected)) throw new Error('Metadata mismatch');
    const image = await publicBytes(fetchImpl, expected.image, 'image/', 600_000);
    const expectedImageHash = record.imageSha256 || record.pinnedMetadata?.fallbackImageSha256;
    if (expectedImageHash && hash(image) !== expectedImageHash) throw new Error('Image mismatch');
    if (record.bannerSha256) {
      const banner = await publicBytes(fetchImpl, expected.banner, 'image/', 600_000);
      if (hash(banner) !== record.bannerSha256) throw new Error('Banner mismatch');
    }
    return {verified:true, uri, image:expected.image, storage:record.pinnedMetadata ? 'pinata' : 'hosted-devnet', checkedAt:new Date().toISOString()};
  } catch {
    throw new Error('Public token metadata or image could not be verified. Retry before approving a launch transaction.');
  }
}

export function createMetadataPublisher({env = process.env, fetchImpl = fetch} = {}) {
  const storage = env.METADATA_STORAGE || 'hosted-devnet';
  if (!['hosted-devnet','pinata'].includes(storage)) throw new Error('METADATA_STORAGE must be hosted-devnet or pinata.');
  return async ({record, image, imageType, banner, bannerType}) => {
    if (storage === 'hosted-devnet') return record;
    const jwt = String(env.PINATA_JWT || (env.PINATA_JWT_FILE ? await readFile(env.PINATA_JWT_FILE, 'utf8') : '')).trim();
    if (!jwt) throw new Error('Durable metadata storage is not configured. No launch transaction was prepared.');
    const pin = async (bytes, mime, name) => {
      const body = new FormData(); body.set('network', 'public'); body.set('cid_version', 'v1');
      body.set('name', name); body.set('file', new Blob([bytes], {type:mime}), name);
      const response = await fetchImpl('https://uploads.pinata.cloud/v3/files', {method:'POST', body,
        headers:{Authorization:`Bearer ${jwt}`}, redirect:'error', signal:AbortSignal.timeout(30_000)});
      if (!response.ok) throw new Error('Pinata upload unavailable');
      return pinnedMetadataUri((await response.json()).data?.cid);
    };
    try {
      const imageUri = await pin(image || fallbackImage, imageType || 'image/svg+xml', `${record.mint}-image`);
      const bannerUri = banner ? await pin(banner, bannerType, `${record.mint}-banner`) : null;
      const pinnedMetadata = {image:imageUri, ...(bannerUri ? {banner:bannerUri} : {}),
        ...(!image ? {fallbackImageSha256:hash(fallbackImage)} : {})};
      const pinned = {...record, pinnedMetadata};
      pinnedMetadata.uri = await pin(Buffer.from(JSON.stringify(publicMetadata(pinned))), 'application/json', `${record.mint}.json`);
      await verifyPublishedMetadata(pinned, {fetchImpl});
      return pinned;
    } catch {
      throw new Error('Durable metadata upload or public verification failed. Retry before approving a launch transaction.');
    }
  };
}
