import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// Client for the internal signer service. When FUNDED_SIGNER_URL is set, the
// app holds no private keys: each role is a handle with only a public key, and
// signing sends the exact message bytes to the signer, which applies its own
// policy before returning a signature.
//
// FUNDED_SIGNER_KEYS lists the public keys ("role=pubkey,..."), so handles are
// available synchronously at startup without a network call.
export const SIGNER_ROLES = Object.freeze({
  keeper: 'SOLANA_KEEPER_SECRET_KEY',
  authority: 'FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY',
  legacyAuthority: 'FUNDED_ROUTER_AUTHORITY_SECRET_KEY',
  referral: 'SOLANA_REFERRAL_PAYOUT_SECRET_KEY',
  'treasury-operations': 'FUNDED_ADMIN_OPERATIONS_SIGNER',
  'treasury-revenue': 'FUNDED_ADMIN_PUMP_REVENUE_SIGNER',
  'treasury-trade': 'FUNDED_ADMIN_TRADE_FEE_SIGNER',
  'treasury-service': 'FUNDED_ADMIN_SERVICE_FEE_SIGNER',
  'treasury-boost': 'FUNDED_ADMIN_BOOST_SIGNER',
});

export function remoteSignerConfigured(env = process.env) { return Boolean(String(env.FUNDED_SIGNER_URL || '').trim()); }

export function parseSignerKeys(value) {
  const keys = new Map();
  for (const part of String(value || '').split(',')) {
    const [role, address] = part.split('=').map(item => item?.trim());
    if (!role || !address || !Object.hasOwn(SIGNER_ROLES, role)) continue;
    try { keys.set(role, new PublicKey(address)); } catch {}
  }
  return keys;
}

export function createRemoteSigner({ env = process.env, fetchImpl = fetch } = {}) {
  const url = String(env.FUNDED_SIGNER_URL || '').trim().replace(/\/$/, '');
  if (!url) return null;
  const keys = parseSignerKeys(env.FUNDED_SIGNER_KEYS);
  let token = String(env.FUNDED_SIGNER_TOKEN || '').trim();
  if (!token && env.FUNDED_SIGNER_TOKEN_FILE) { try { token = readFileSync(env.FUNDED_SIGNER_TOKEN_FILE, 'utf8').trim(); } catch {} }
  const handles = new Map();
  async function sign(role, message, version) {
    const response = await fetchImpl(`${url}/sign`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role, version, message: Buffer.from(message).toString('base64') }) });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.signature !== 'string')
      throw Object.assign(new Error(`The signer refused this transaction${body?.error ? `: ${body.error}` : '.'}`), { status: 503, signerRefused: true });
    const signature = bs58.decode(body.signature);
    if (signature.length !== 64) throw new Error('The signer returned an invalid signature.');
    return signature;
  }
  // A handle carries only the public key; signing goes through the service.
  function handle(role) {
    const publicKey = keys.get(role);
    if (!publicKey) return null;
    if (!handles.has(role)) handles.set(role, Object.freeze({ publicKey, remoteRole: role, remoteSign: (message, version) => sign(role, message, version) }));
    return handles.get(role);
  }
  return { handle, roles: () => [...keys.keys()] };
}

// With the internal signer configured, a process must hold no private key.
const KEY_VARIABLE = /(SECRET_KEY|KEYPAIR_PATH|^FUNDED_ADMIN_.*_SIGNER)(_FILE)?$/;
export function assertNoLocalKeys(env = process.env) {
  if (!remoteSignerConfigured(env)) return;
  const found = Object.keys(env).filter(name => KEY_VARIABLE.test(name) && String(env[name] || '').trim());
  if (found.length) throw new Error(`The internal signer is configured, so this process must not hold private keys (${found.join(', ')}).`);
}
