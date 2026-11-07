// Offline estimate of SOL needed to deploy upgradeable Solana programs.
// Never contacts a cluster or loads keys: it only reads compiled .so files.
//
//   node scripts/estimate-program-deploy-cost.mjs <program.so>... [--max-len-ratio=1] [--priority-micro-lamports=0] [--lamports-per-byte=5080]
//
// Rent uses (128-byte account overhead + data bytes) x lamports per byte. Devnet and mainnet
// both returned 5,080 lamports per byte on 2026-11-07 (getMinimumBalanceForRentExemption(0)
// = 650,240); pass --lamports-per-byte to use a newer rate. Upgradeable programs lock rent on the program
// account (36 bytes) and on ProgramData (45-byte header + max_len). Deploying first
// writes the binary into a buffer account of the same size; that rent is refunded when
// the deploy succeeds (or when an abandoned buffer is closed).
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const DEFAULT_LAMPORTS_PER_BYTE = 5_080;
const ACCOUNT_OVERHEAD = 128;
const PROGRAM_ACCOUNT_BYTES = 36;
const PROGRAMDATA_HEADER_BYTES = 45;
const BUFFER_HEADER_BYTES = 37;
// Each upload transaction carries about this many program bytes (1232-byte packet limit).
const BYTES_PER_WRITE = 1_000;
const BASE_FEE_PER_SIGNATURE = 5_000;
const WRITE_COMPUTE_UNITS = 2_000;

export const rentExempt = (bytes, lamportsPerByte = DEFAULT_LAMPORTS_PER_BYTE) => (ACCOUNT_OVERHEAD + bytes) * lamportsPerByte;

export function estimateProgram({ name, bytes, maxLenRatio = 1, priorityMicroLamports = 0, lamportsPerByte = DEFAULT_LAMPORTS_PER_BYTE }) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${name}: program size must be a positive byte count.`);
  if (!(maxLenRatio >= 1)) throw new Error('--max-len-ratio must be at least 1.');
  const maxLen = Math.ceil(bytes * maxLenRatio);
  const writes = Math.ceil(bytes / BYTES_PER_WRITE);
  const priorityPerTx = Math.ceil(priorityMicroLamports * WRITE_COMPUTE_UNITS / 1_000_000);
  const lockedLamports = rentExempt(PROGRAM_ACCOUNT_BYTES, lamportsPerByte) + rentExempt(PROGRAMDATA_HEADER_BYTES + maxLen, lamportsPerByte);
  const bufferLamports = rentExempt(BUFFER_HEADER_BYTES + bytes, lamportsPerByte);
  // Upload writes plus buffer creation and the final deploy instruction.
  const feeLamports = (writes + 2) * (BASE_FEE_PER_SIGNATURE + priorityPerTx);
  return { name, bytes, maxLen, writes, lockedLamports, bufferLamports, feeLamports,
    peakLamports: lockedLamports + bufferLamports + feeLamports };
}

export function estimateDeployment(programs, options = {}) {
  const rows = programs.map(program => estimateProgram({ ...program, ...options }));
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  // Programs deploy one at a time, so only one buffer is outstanding at once.
  const largestBuffer = Math.max(...rows.map(row => row.bufferLamports));
  return { rows, lockedLamports: sum('lockedLamports'), feeLamports: sum('feeLamports'),
    peakLamports: sum('lockedLamports') + sum('feeLamports') + largestBuffer, largestBufferLamports: largestBuffer };
}

const sol = lamports => (lamports / LAMPORTS_PER_SOL).toFixed(3);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => Number(args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  const files = args.filter(arg => !arg.startsWith('--'));
  if (!files.length) {
    console.error('Usage: node scripts/estimate-program-deploy-cost.mjs <program.so>... [--max-len-ratio=1] [--priority-micro-lamports=0]');
    process.exit(2);
  }
  const result = estimateDeployment(files.map(file => ({ name: basename(file), bytes: statSync(file).size })),
    { maxLenRatio: option('max-len-ratio', 1), priorityMicroLamports: option('priority-micro-lamports', 0),
      lamportsPerByte: option('lamports-per-byte', 5_080) });
  for (const row of result.rows) {
    console.log(`${row.name}: ${(row.bytes / 1024).toFixed(0)} KB, max_len ${(row.maxLen / 1024).toFixed(0)} KB, ` +
      `locked ${sol(row.lockedLamports)} SOL, buffer ${sol(row.bufferLamports)} SOL (refunded), ` +
      `${row.writes + 2} transactions ${sol(row.feeLamports)} SOL`);
  }
  console.log(`Locked after deploy: ${sol(result.lockedLamports)} SOL`);
  console.log(`Transaction fees:    ${sol(result.feeLamports)} SOL`);
  console.log(`Hold during deploy:  ${sol(result.peakLamports)} SOL (one ${sol(result.largestBufferLamports)} SOL buffer outstanding at a time)`);
}
