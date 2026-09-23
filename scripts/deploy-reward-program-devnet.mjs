import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

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

function run(command, args, { inherit = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(`${command} exited with status ${result.status}: ${String(result.stderr || '').trim()}`);
  return result;
}

const [binaryArg, programKeypairArg] = process.argv.slice(2);
if (!binaryArg || !programKeypairArg) throw new Error('Usage: node scripts/deploy-reward-program-devnet.mjs <program.so> <program-keypair.json>');

const binary = resolve(binaryArg);
const programKeypairPath = resolve(programKeypairArg);
const expectedProgram = String(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
if (!expectedProgram) throw new Error('FUNDED_FEE_ROUTER_PROGRAM_ID is required.');
const keypairProgram = run('solana-keygen', ['pubkey', programKeypairPath]).stdout.trim();
if (keypairProgram !== expectedProgram) throw new Error(`Program keypair resolves to ${keypairProgram}, expected ${expectedProgram}.`);

const encodedPayer = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || '').trim();
if (!encodedPayer) throw new Error('A Devnet router authority/creator secret is required for deployment.');
const payerBytes = decodeBase58(encodedPayer);
if (payerBytes.length !== 64) throw new Error(`Deployment secret decoded to ${payerBytes.length} bytes; expected 64.`);
const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
if (run('solana', ['genesis-hash', '--url', rpcUrl]).stdout.trim() !== DEVNET_GENESIS_HASH) throw new Error('Refusing to deploy: configured RPC is not Solana Devnet.');
if (run('solana', ['account', expectedProgram, '--url', rpcUrl], { allowFailure: true }).status === 0) throw new Error('Refusing a new deployment because the target program address already exists.');

const secretDirectory = mkdtempSync(join(tmpdir(), 'funded-devnet-deploy-'));
const payerPath = join(secretDirectory, 'payer.json');
try {
  writeFileSync(payerPath, JSON.stringify(Array.from(payerBytes)), { mode: 0o600 });
  const payerPublicKey = run('solana-keygen', ['pubkey', payerPath]).stdout.trim();
  run('solana', [
    'program', 'deploy', binary,
    '--program-id', programKeypairPath,
    '--keypair', payerPath,
    '--upgrade-authority', payerPath,
    '--url', rpcUrl,
    '--commitment', 'finalized',
  ], { inherit: true });
  const deployed = JSON.parse(run('solana', ['program', 'show', expectedProgram, '--keypair', payerPath, '--url', rpcUrl, '--output', 'json']).stdout);
  console.log(JSON.stringify({
    status: 'deployed',
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
