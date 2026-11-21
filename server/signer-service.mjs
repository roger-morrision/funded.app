import { createServer } from 'node:http';
import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Connection, Keypair, PublicKey, VersionedMessage, VersionedTransaction, Message } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { SIGNER_ROLES } from './remote-signer.mjs';
import { evaluate, decodeMessage, createUsage, adminWalletSet } from './signer-policy.mjs';
import { loadServerEnvironment } from './environment.mjs';

// Internal signer: the only process holding the app's Devnet private keys.
// It has no public port, accepts requests only with FUNDED_SIGNER_TOKEN, and
// applies signer-policy.mjs to every message before signing. Every decision is
// appended to FUNDED_SIGNER_JOURNAL.
const TREASURY_EXPECTED = { 'treasury-operations': 'FUNDED_V3_OPERATIONS_RECIPIENT', 'treasury-revenue': 'FUNDED_PUMP_REVENUE_WALLET',
  'treasury-trade': 'FUNDED_TRADE_FEE_OWNER', 'treasury-service': 'FUNDED_SERVICE_FEE_RECIPIENT', 'treasury-boost': 'FUNDED_BOOST_PAYMENT_WALLET' };
// Rules that are never relaxed by observe mode.
const HARD = /^(program-loader|token-set-authority|system-authority-change|router-|treasury-|signer-not-required)/;

function parseKey(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  return Keypair.fromSecretKey(text.startsWith('[') ? Uint8Array.from(JSON.parse(text)) : bs58.decode(text));
}

export function loadSignerKeys(env = process.env) {
  const keys = new Map();
  for (const [role, variable] of Object.entries(SIGNER_ROLES)) {
    let key = null;
    try { key = parseKey(env[variable]); } catch { continue; }
    if (!key) continue;
    const expected = TREASURY_EXPECTED[role] && (env[TREASURY_EXPECTED[role]] || (role === 'treasury-trade' ? env.VITE_FUNDED_TRADE_FEE_OWNER : ''));
    if (TREASURY_EXPECTED[role] && key.publicKey.toBase58() !== expected) continue;
    keys.set(role, key);
  }
  return keys;
}

export function createSigner({ env = process.env, keys = loadSignerKeys(env), connection = null, now = Date.now, journal = () => {} }) {
  let token = String(env.FUNDED_SIGNER_TOKEN || '').trim();
  if (!token && env.FUNDED_SIGNER_TOKEN_FILE) { try { token = readFileSync(env.FUNDED_SIGNER_TOKEN_FILE, 'utf8').trim(); } catch {} }
  if (token.length < 32) throw new Error('FUNDED_SIGNER_TOKEN must be at least 32 characters.');
  const expected = Buffer.from(`Bearer ${token}`);
  const usage = new Map([...keys.keys()].map(role => [role, createUsage()]));
  let journalFailed = false;
  const observeOthers = String(env.FUNDED_SIGNER_ENFORCE || 'all') === 'treasury';
  const authorized = req => { const actual = Buffer.from(String(req.headers.authorization || ''));
    return actual.length === expected.length && timingSafeEqual(actual, expected); };

  async function simulatedOutflow(bytes, version, signer) {
    if (!connection) return null;
    try {
      const message = version === 'v0' ? VersionedMessage.deserialize(bytes) : Message.from(bytes);
      const [before, result] = await Promise.all([connection.getBalance(new PublicKey(signer), 'confirmed'),
        connection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed',
          accounts: { encoding: 'base64', addresses: [signer] } })]);
      if (result.value.err || !result.value.accounts?.[0]) return null;
      return BigInt(Math.max(0, before - result.value.accounts[0].lamports));
    } catch { return null; }
  }

  async function sign({ role, message, version }) {
    if (journalFailed) return { status: 503, body: { error: 'Signer journal requires recovery.' } };
    const key = keys.get(role);
    if (!key) return { status: 404, body: { error: 'Unknown signer role.' } };
    if (!['legacy', 'v0'].includes(version) || typeof message !== 'string') return { status: 400, body: { error: 'Invalid sign request.' } };
    const bytes = Buffer.from(message, 'base64');
    if (bytes.length < 64 || bytes.length > 1232) return { status: 400, body: { error: 'Invalid message size.' } };
    let decoded;
    try { decoded = decodeMessage(bytes, version); } catch { return { status: 400, body: { error: 'Message could not be decoded.' } }; }
    const signer = key.publicKey.toBase58();
    const simulated = await simulatedOutflow(bytes, version, signer);
    if (journalFailed) return { status: 503, body: { error: 'Signer journal requires recovery.' } };
    const at = now();
    const result = evaluate({ role, signer, decoded, env, usage: usage.get(role), now: at, adminWallets: adminWalletSet(env), simulatedOutflow: simulated });
    const blocking = result.violations.filter(rule => !observeOthers || role.startsWith('treasury-') || HARD.test(rule));
    const entry = { at: new Date(at).toISOString(), role, signer, feePayer: decoded.feePayer, programs: result.programs,
      outflowLamports: String(result.outflow), simulated: simulated !== null, violations: result.violations,
      decision: blocking.length ? 'refused' : 'signed', digest: createHash('sha256').update(bytes).digest('hex') };
    try { journal(entry); }
    catch {
      journalFailed = true;
      throw new Error('Signer journal write failed; signing stopped until recovery.');
    }
    if (blocking.length) return { status: 403, body: { error: blocking.join(', ') } };
    usage.get(role).add(at, result.outflow);
    return { status: 200, body: { signature: bs58.encode(nacl.sign.detached(bytes, key.secretKey)) } };
  }

  async function handle(req, res) {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, roles: keys.size });
      if (!authorized(req)) return reply(401, { error: 'Unauthorized.' });
      if (req.method === 'GET' && req.url === '/keys')
        return reply(200, { keys: Object.fromEntries([...keys].map(([role, key]) => [role, key.publicKey.toBase58()])) });
      if (req.method !== 'POST' || req.url !== '/sign') return reply(404, { error: 'Not found.' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 8192) return reply(413, { error: 'Request too large.' }); }
      const out = await sign(JSON.parse(raw || '{}'));
      return reply(out.status, out.body);
    } catch { return reply(500, { error: 'Signer error.' }); }
  }
  return { handle, sign, usage, roles: () => [...keys.keys()] };
}

export function replayJournal(path, signer) {
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('Signer journal is unavailable; signing must remain stopped.');
  }
  // Validate the ENTIRE journal before restoring usage. A damaged tail must
  // never silently reset the rolling withdrawal budget on restart.
  let rows;
  try {
    if (contents.trim() && !contents.endsWith('\n')) throw Error();
    rows = contents.split('\n').filter(line => line.trim()).map(line => {
      const row = JSON.parse(line), at = Date.parse(row.at);
      if (!['signed', 'refused'].includes(row.decision) || typeof row.role !== 'string' || !Object.hasOwn(SIGNER_ROLES, row.role)
        || typeof row.at !== 'string' || !Number.isSafeInteger(at) || at < 0 || new Date(at).toISOString() !== row.at
        || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)
        || typeof row.outflowLamports !== 'string' || !/^\d+$/.test(row.outflowLamports)) throw Error();
      return { ...row, timestamp: at, lamports: BigInt(row.outflowLamports) };
    });
  } catch {
    throw new Error('Signer journal is corrupt; reconcile it before restarting signing.');
  }
  for (const row of rows.sort((a, b) => a.timestamp - b.timestamp)) {
    if (row.decision === 'signed') signer.usage.get(row.role)?.add(row.timestamp, row.lamports);
  }
}

// Flush the reservation to disk BEFORE returning a usable signature. Ordinary
// appendFileSync alone can acknowledge a write still sitting in the OS cache.
export function appendSignerJournal(path, entry) {
  appendFileSync(path, JSON.stringify(entry) + '\n', { mode: 0o600, flush: true });
}

async function main() {
  loadServerEnvironment();
  if (process.env.SOLANA_CLUSTER !== 'devnet') throw new Error('The signer service runs on Devnet only.');
  const path = process.env.FUNDED_SIGNER_JOURNAL || '/app/data/signer/journal.jsonl';
  mkdirSync(dirname(path), { recursive: true });
  const connection = process.env.SOLANA_RPC_URL ? new Connection(process.env.SOLANA_RPC_URL, 'confirmed') : null;
  const signer = createSigner({ connection, journal: entry => appendSignerJournal(path, entry) });
  replayJournal(path, signer);
  const port = Number(process.env.FUNDED_SIGNER_PORT || 8790);
  createServer((req, res) => { void signer.handle(req, res); }).listen(port, '0.0.0.0', () =>
    console.log(JSON.stringify({ event: 'signer_listening', port, roles: signer.roles() })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(JSON.stringify({ event: 'signer_start_failed', message: error.message })); process.exit(1); });
