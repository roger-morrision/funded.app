import { createHmac, randomBytes } from 'node:crypto';

// OAuth 1.0a signature base strings follow RFC 5849. JSON request bodies are
// deliberately excluded; only form-encoded bodies contribute body parameters.
const encode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g,
  character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

function signedParameters({ method, url, apiKey, apiSecret, accessToken, accessTokenSecret,
  nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000) }) {
  if (!['GET', 'POST'].includes(method) || !(url instanceof URL) || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.hash) throw new Error('OAuth request target is invalid.');
  if ([apiKey, apiSecret, accessToken, accessTokenSecret].some(value => typeof value !== 'string' || !value.trim()))
    throw new Error('A complete X OAuth 1.0a credential set is required.');
  if (!/^[A-Za-z0-9]+$/.test(nonce) || !Number.isSafeInteger(timestamp) || timestamp <= 0)
    throw new Error('X OAuth nonce or timestamp is invalid.');
  const oauth = {
    oauth_consumer_key: apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp), oauth_token: accessToken, oauth_version: '1.0',
  };
  const parameters = [...Object.entries(oauth), ...url.searchParams.entries()]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([keyA, valueA], [keyB, valueB]) => keyA < keyB ? -1 : keyA > keyB ? 1 : valueA < valueB ? -1 : valueA > valueB ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('&');
  const base = `${method}&${encode(`${url.origin}${url.pathname}`)}&${encode(parameters)}`;
  const key = `${encode(apiSecret)}&${encode(accessTokenSecret)}`;
  oauth.oauth_signature = createHmac('sha1', key).update(base).digest('base64');
  return oauth;
}

export function oauth1Signature(options) {
  return signedParameters(options).oauth_signature;
}

export function xOAuth1Authorization(options) {
  const { url } = options;
  if (!(url instanceof URL) || url.protocol !== 'https:' || url.hostname !== 'api.x.com')
    throw new Error('X OAuth request target is invalid.');
  const oauth = signedParameters(options);
  return `OAuth ${Object.entries(oauth).map(([name, value]) => `${encode(name)}="${encode(value)}"`).join(', ')}`;
}
