// Reads the JSON a token's on-chain metadata URI points to (logo, description,
// links). The URI is chosen by the token's creator, so treat it as untrusted:
// HTTPS only (ipfs:// and ar:// map to public gateways), public addresses only,
// no redirects to other hosts, small size limit, short timeout, sanitized output.
import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';

const MAX_BYTES = 256 * 1024;
const CACHE_MS = 10 * 60_000;
const MAX_CACHE = 500;
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const ARWEAVE_GATEWAY = 'https://arweave.net/';

export function resolveMetadataUrl(value) {
  const raw = String(value || '').trim().replace(/\0/g, '');
  if (!raw || raw.length > 2048) return null;
  let url;
  if (/^ipfs:\/\//i.test(raw)) url = IPFS_GATEWAY + raw.replace(/^ipfs:\/\/(ipfs\/)?/i, '');
  else if (/^ar:\/\//i.test(raw)) url = ARWEAVE_GATEWAY + raw.replace(/^ar:\/\//i, '');
  else url = raw;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    if (parsed.port && parsed.port !== '443') return null;
    if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(parsed.hostname)) return null;
    return parsed.href;
  } catch { return null; }
}

export function isPrivateAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
  }
  return true;
}

const text = (value, max) => typeof value === 'string' && value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ? value.trim().slice(0, max) : null;
const link = value => {
  const url = resolveMetadataUrl(value);
  return url && !/\.(json)$/i.test(new URL(url).pathname) ? url : null;
};
const handle = (value, host) => {
  const raw = text(value, 200);
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return link(raw);
  const name = raw.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,40}$/.test(name) ? `https://${host}/${name}` : null;
};

// Common token JSON shapes: Metaplex (image, external_url, properties.files),
// pump.fun (twitter, telegram, website), extensions.{website,twitter,telegram}.
export function sanitizeOffchainMetadata(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const ext = json.extensions && typeof json.extensions === 'object' ? json.extensions : {};
  const file = Array.isArray(json.properties?.files) ? json.properties.files.find(item => /^image\//.test(String(item?.type || ''))) : null;
  return {
    name: text(json.name, 64),
    symbol: text(json.symbol, 20),
    description: text(json.description, 1000),
    image: link(json.image) || link(file?.uri) || link(json.logoURI),
    website: link(json.website) || link(ext.website) || link(json.external_url),
    twitter: handle(json.twitter || ext.twitter, 'x.com'),
    telegram: handle(json.telegram || ext.telegram, 't.me'),
    discord: link(json.discord || ext.discord),
  };
}

// Default transport: node:https with the address check inside the socket's DNS
// lookup, so the checked address is the one connected to (no DNS rebinding).
export function httpsJson(url, { timeoutMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    const guardedLookup = (host, options, callback) => dnsLookup(host, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
      if (!list.length || list.some(item => isPrivateAddress(item.address))) return callback(new Error('Metadata host is not public.'));
      return options.all ? callback(null, list) : callback(null, list[0].address, list[0].family);
    });
    const req = request(url, { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'richpad-metadata/1' }, lookup: guardedLookup, timeout: timeoutMs }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Metadata request failed (${res.statusCode}).`)); }
      if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); return reject(new Error('Metadata is too large.')); }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { res.destroy(); reject(new Error('Metadata is too large.')); } else chunks.push(chunk); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Metadata request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

export function createOffchainMetadataReader({ getJson = url => httpsJson(url), now = Date.now } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const download = url => {
    const host = new URL(url).hostname.replace(/^[|]$/g, '');
    if (isIP(host) && isPrivateAddress(host)) throw new Error('Metadata host is not public.');
    return getJson(url);
  };
  return async function readOffchainMetadata(uri) {
    const url = resolveMetadataUrl(uri);
    if (!url) return { status: uri ? 'unsupported-uri' : 'missing', metadata: null };
    const cached = cache.get(url);
    if (cached && now() - cached.at < CACHE_MS) return cached.data;
    if (!inflight.has(url)) {
      const pending = (async () => {
        let data;
        try {
          const metadata = sanitizeOffchainMetadata(await download(url));
          data = { status: metadata ? 'available' : 'invalid', metadata };
        } catch { data = { status: 'unavailable', metadata: null }; }
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
        cache.set(url, { at: now(), data });
        return data;
      })().finally(() => inflight.delete(url));
      inflight.set(url, pending);
    }
    return inflight.get(url);
  };
}
