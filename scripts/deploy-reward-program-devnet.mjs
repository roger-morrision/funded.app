import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair } from '@solana/web3.js';

const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value) {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('The configured deployment secret is not valid base58.');
    number = (number * 58n) + BigInt(digit);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const leadingZeroes = value.match(/^1*/)?.[0].length || 0;
  return Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(hex, 'hex')]);
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw result.error;
  // CLI errors may contain credential-bearing RPC URLs. Keep them out of logs.
  if (!allowFailure && result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
  return result;
}

const [binaryArg, programKeypairArg, mode] = process.argv.slice(2);
if (!binaryArg || !programKeypairArg || (mode && !['--upgrade', '--upgrade-preflight'].includes(mode))) {
  throw new Error('Usage: node scripts/deploy-reward-program-devnet.mjs <program.so> <program-keypair.json> [--upgrade|--upgrade-preflight]');
}
const upgrading = mode === '--upgrade' || mode === '--upgrade-preflight';

const binary = resolve(binaryArg);
const programKeypairPath = resolve(programKeypairArg);
const maxLengthInput = String(process.env.FUNDED_ROUTER_PROGRAM_MAX_LEN || '').trim();
const maxLength = maxLengthInput ? Number(maxLengthInput) : null;
if (maxLength !== null && (!Number.isSafeInteger(maxLength) || maxLength < statSync(binary).size)) {
  throw new Error('FUNDED_ROUTER_PROGRAM_MAX_LEN must be an integer at least as large as the program binary.');
}
const expectedProgram = String(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
if (!expectedProgram) throw new Error('FUNDED_FEE_ROUTER_PROGRAM_ID is required.');
const keypairProgram = run('solana-keygen', ['pubkey', programKeypairPath]).stdout.trim();
if (keypairProgram !== expectedProgram) throw new Error(`Program keypair resolves to ${keypairProgram}, expected ${expectedProgram}.`);

const encodedPayer = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim();
if (!encodedPayer) throw new Error('A dedicated Devnet router authority secret is required for deployment.');
const payerBytes = decodeBase58(encodedPayer);
if (payerBytes.length !== 64) throw new Error(`Deployment secret decoded to ${payerBytes.length} bytes; expected 64.`);
const payerPublicKey = Keypair.fromSecretKey(Uint8Array.from(payerBytes)).publicKey.toBase58();
const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
if (run('solana', ['genesis-hash', '--url', rpcUrl]).stdout.trim() !== DEVNET_GENESIS_HASH) throw new Error('Refusing to deploy: configured RPC is not Solana Devnet.');
if (upgrading) {
  if (expectedProgram !== '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm') {
    throw new Error('Only the isolated V3 QA program may use this upgrade path.');
  }
  const prior = JSON.parse(run('solana', ['program', 'show', expectedProgram, '--url', rpcUrl,
    '--output', 'json']).stdout);
  if (prior.programId !== expectedProgram || prior.owner !== 'BPFLoaderUpgradeab1e11111111111111111111111'
    || prior.programdataAddress !== '4hw9GBAx5BicgiGCiw9hKVu1Xs4xWDrdqXSAFzgn4bwa'
    || prior.authority !== payerPublicKey || !Number.isSafeInteger(prior.dataLen)
    || prior.dataLen < statSync(binary).size) {
    throw new Error('The V3 QA program identity, upgrade authority, or allocated space changed.');
  }
} else {
  const existingProgram = run('solana', ['account', expectedProgram, '--url', rpcUrl], { allowFailure: true });
  if (existingProgram.status === 0) throw new Error('Refusing a new deployment because the target program address already exists.');
  const accountError = `${existingProgram.stdout || ''}\n${existingProgram.stderr || ''}`;
  if (!accountError.includes(`AccountNotFound: pubkey=${expectedProgram}`) || /429|Too Many Requests/i.test(accountError)) {
    throw new Error('Could not verify that the program address is unused. Check Devnet RPC and retry later.');
  }
}
if (mode === '--upgrade-preflight') {
  console.log(JSON.stringify({ status: 'ready-for-v3-qa-upgrade', cluster: 'devnet',
    program: expectedProgram, authority: payerPublicKey, binaryBytes: statSync(binary).size }, null, 2));
  process.exit(0);
}

const secretDirectory = mkdtempSync(join(tmpdir(), 'funded-devnet-deploy-'));
const payerPath = join(secretDirectory, 'payer.json');
try {
  writeFileSync(payerPath, JSON.stringify(Array.from(payerBytes)), { mode: 0o600 });
  if (run('solana-keygen', ['pubkey', payerPath]).stdout.trim() !== payerPublicKey) {
    throw new Error('Deployment payer keypair does not match its decoded secret.');
  }
  run('solana', [
    'program', 'deploy', binary,
    '--program-id', programKeypairPath,
    ...(upgrading || maxLength === null ? [] : ['--max-len', String(maxLength)]),
    '--keypair', payerPath,
    '--upgrade-authority', payerPath,
    '--url', rpcUrl,
    '--commitment', 'finalized',
  ]);
  const deployed = JSON.parse(run('solana', ['program', 'show', expectedProgram, '--keypair', payerPath, '--url', rpcUrl, '--output', 'json']).stdout);
  console.log(JSON.stringify({
    status: mode === '--upgrade' ? 'upgraded' : 'deployed',
    cluster: 'devnet',
    program: expectedProgram,
    payer: payerPublicKey,
    programDataAddress: deployed.programdataAddress || deployed.programDataAddress || null,
    authority: deployed.authority || null,
    privateKeyPersisted: false,
  }, null, 2));
} finally {
  rmSync(secretDirectory, { recursive: true, force: true });
}
