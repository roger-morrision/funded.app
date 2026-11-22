import { createHash } from 'node:crypto';
import { Message, PublicKey, SystemProgram, VersionedMessage } from '@solana/web3.js';
import bs58 from 'bs58';

// Rules the internal signer applies to every message before signing it. They
// hold even if the web app is fully compromised:
// - always refused: program loaders (upgrades), token SetAuthority, System
//   Assign / nonce authority changes by a signer key, and fee-router admin
//   instructions (authority rotation, header repair, price-signer changes);
// - treasury keys sign only one System transfer to an admin wallet, paid by
//   that admin wallet;
// - payout keys (keeper, authority, referral) may call approved programs only.
//   Payouts to users are never capped per transaction or per day and are not
//   rate limited; SOL leaving each key is still measured, journaled and
//   watched by the outflow alerts.
const SOL = 1_000_000_000n, DAY_MS = 24 * 60 * 60 * 1000;
const anchor = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');
export const DENIED_ROUTER_INSTRUCTIONS = Object.freeze(['rotate_authority', 'repair_header', 'configure_buyback_price_signer',
  'migrate_mint_fee_ledger', 'initialize', 'recover_qa_settlement_v3',
  // Mainnet guard: only the upgrade owner wallet and the offline guardian sign these.
  'configure_rich_assets', 'configure_protocol_guard', 'set_protocol_pause', 'cancel_reward_cycle']);
const DENIED_DISCRIMINATORS = new Map(DENIED_ROUTER_INSTRUCTIONS.map(name => [anchor(name), name]));
const LOADERS = new Set(['BPFLoaderUpgradeab1e11111111111111111111111', 'BPFLoader2111111111111111111111111111111111',
  'BPFLoader1111111111111111111111111111111111', 'LoaderV411111111111111111111111111111111111', 'NativeLoader1111111111111111111111111111111']);
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const SYSTEM = SystemProgram.programId.toBase58();
// Programs the app's normal Devnet flows call.
export const BASE_PROGRAMS = Object.freeze([SYSTEM, 'ComputeBudget111111111111111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo', ...TOKEN_PROGRAMS,
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'AddressLookupTab1e1111111111111111111111111',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s']);

function setting(env, name, fallback) {
  const raw = env[name];
  return raw !== undefined && /^\d+$/.test(String(raw)) ? BigInt(raw) : fallback;
}
export function signerLimits(env = process.env) {
  return {
    treasuryTxLamports: setting(env, 'FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS', 10n * SOL),
    treasuryDailyLamports: setting(env, 'FUNDED_ADMIN_WITHDRAW_DAILY_LAMPORTS', 20n * SOL),
    perMinute: Number(setting(env, 'FUNDED_SIGNER_TREASURY_PER_MINUTE', 10n)),
  };
}
export function allowedPrograms(env = process.env) {
  const extra = String(env.FUNDED_SIGNER_EXTRA_PROGRAMS || '').split(',').map(value => value.trim()).filter(Boolean);
  return new Set([...BASE_PROGRAMS, env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID, env.FUNDED_FEE_ROUTER_PROGRAM_ID,
    env.FUNDED_DEVELOPER_TOKEN_LOCK_PROGRAM_ID, env.FUNDED_DEVELOPER_LOCK_PROGRAM_ID, ...extra].filter(Boolean));
}

// Decodes a message into instructions with static account keys.
export function decodeMessage(bytes, version) {
  const message = version === 'v0' ? VersionedMessage.deserialize(bytes) : Message.from(bytes);
  const keys = (message.staticAccountKeys || message.accountKeys).map(key => key.toBase58());
  const instructions = (message.compiledInstructions || message.instructions.map(ix => ({ programIdIndex: ix.programIdIndex,
    accountKeyIndexes: ix.accounts, data: bs58.decode(ix.data) }))).map(ix => ({
    program: keys[ix.programIdIndex], accounts: ix.accountKeyIndexes.map(index => keys[index] || null), data: Buffer.from(ix.data) }));
  return { keys, signers: keys.slice(0, message.header.numRequiredSignatures), feePayer: keys[0], instructions };
}

// Explicit lamports leaving `signer` in System instructions.
function systemOutflow(ix, signer) {
  if (ix.program !== SYSTEM || ix.data.length < 4) return 0n;
  const kind = ix.data.readUInt32LE(0);
  if (kind === 2 && ix.accounts[0] === signer && ix.data.length >= 12) return ix.data.readBigUInt64LE(4); // Transfer
  if (kind === 0 && ix.accounts[0] === signer && ix.data.length >= 12) return ix.data.readBigUInt64LE(4); // CreateAccount
  if (kind === 11 && ix.accounts[1] === signer && ix.data.length >= 12) return ix.data.readBigUInt64LE(4); // TransferWithSeed (from base)
  return 0n;
}

export function evaluate({ role, signer, decoded, env = process.env, usage, now = Date.now(), adminWallets = new Set(), simulatedOutflow = null }) {
  const violations = [], limits = signerLimits(env), programs = allowedPrograms(env);
  if (!decoded.signers.includes(signer)) violations.push('signer-not-required');
  let explicit = 0n;
  for (const ix of decoded.instructions) {
    if (LOADERS.has(ix.program)) violations.push('program-loader');
    if (TOKEN_PROGRAMS.has(ix.program) && ix.data[0] === 6) violations.push('token-set-authority');
    if (ix.program === SYSTEM && ix.data.length >= 4 && [1, 5, 7, 10].includes(ix.data.readUInt32LE(0)) && ix.accounts.includes(signer))
      violations.push('system-authority-change');
    const denied = ix.data.length >= 8 && DENIED_DISCRIMINATORS.get(ix.data.subarray(0, 8).toString('hex'));
    if (denied && (ix.program === env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || ix.program === env.FUNDED_FEE_ROUTER_PROGRAM_ID)) violations.push(`router-${denied}`);
    explicit += systemOutflow(ix, signer);
  }
  const outflow = simulatedOutflow !== null && simulatedOutflow > explicit ? simulatedOutflow : explicit;
  const treasury = role.startsWith('treasury-');
  if (treasury) {
    const [ix] = decoded.instructions;
    const transfer = decoded.instructions.length === 1 && ix.program === SYSTEM && ix.data.length >= 12 && ix.data.readUInt32LE(0) === 2 && ix.accounts[0] === signer;
    if (!transfer) violations.push('treasury-transfer-only');
    else if (!adminWallets.has(ix.accounts[1]) || decoded.feePayer !== ix.accounts[1]) violations.push('treasury-destination-not-admin');
    if (outflow > limits.treasuryTxLamports) violations.push('treasury-tx-cap');
    if (usage.lamports(now) + outflow > limits.treasuryDailyLamports) violations.push('treasury-daily-cap');
    if (usage.count(now, 60_000) >= limits.perMinute) violations.push('treasury-rate-minute');
  } else {
    for (const ix of decoded.instructions) if (!programs.has(ix.program)) violations.push(`program-not-allowed:${ix.program}`);
  }
  return { violations: [...new Set(violations)], outflow, programs: [...new Set(decoded.instructions.map(ix => ix.program))] };
}

// Rolling 24-hour usage per role, rebuilt from the journal at start.
export function createUsage() {
  const rows = [];
  const prune = now => { while (rows.length && rows[0].at <= now - DAY_MS) rows.shift(); };
  return {
    add(at, lamports) { rows.push({ at, lamports }); },
    lamports(now) { prune(now); return rows.reduce((sum, row) => sum + row.lamports, 0n); },
    count(now, windowMs) { prune(now); return rows.filter(row => row.at > now - windowMs).length; },
  };
}
export const adminWalletSet = env => new Set(String(env.FUNDED_ADMIN_WALLETS || '').split(',').map(value => {
  try { return new PublicKey(value.trim()).toBase58(); } catch { return null; } }).filter(Boolean));
