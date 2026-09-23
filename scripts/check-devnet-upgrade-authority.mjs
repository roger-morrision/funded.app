import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import bs58 from 'bs58';
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';

function keypairFromText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {}
  try { return Keypair.fromSecretKey(bs58.decode(trimmed)); } catch { return null; }
}

const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
const program = await connection.getAccountInfo(programId, 'finalized');
if (!program?.executable || program.data.length < 36 || program.data.readUInt32LE(0) !== 2) throw new Error('Expected an executable upgradeable Devnet program.');
const programDataAddress = new PublicKey(program.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataAddress, 'finalized');
if (!programData || programData.data.length < 45 || programData.data.readUInt32LE(0) !== 3) throw new Error('Upgradeable program-data account is invalid.');
const upgradeAuthority = programData.data[12] === 1 ? new PublicKey(programData.data.subarray(13, 45)) : null;
const candidates = [];
for (const [name, value] of Object.entries(process.env)) {
  if (!/(SECRET_KEY|KEYPAIR)$/i.test(name) || !value) continue;
  let keypair = keypairFromText(value);
  if (!keypair && /KEYPAIR/i.test(name)) {
    try { keypair = keypairFromText(await readFile(resolve(value), 'utf8')); } catch {}
  }
  if (keypair) candidates.push({ source:`env:${name}`, publicKey:keypair.publicKey.toBase58() });
}
const paths = [
  resolve('contracts/funded-fee-router/target/deploy/funded_fee_router-keypair.json'),
  resolve(process.env.USERPROFILE || '', '.config/solana/id.json'),
  resolve(process.env.APPDATA || '', 'solana/id.json'),
  ...process.argv.slice(2).map(value => resolve(value)),
];
for (const path of [...new Set(paths)]) {
  try {
    const keypair = keypairFromText(await readFile(path, 'utf8'));
    if (keypair) candidates.push({ source:`file:${path}`, publicKey:keypair.publicKey.toBase58() });
  } catch {}
}
const deduped = [...new Map(candidates.map(row => [`${row.source}:${row.publicKey}`, row])).values()].map(row => ({ ...row, matchesUpgradeAuthority:Boolean(upgradeAuthority && row.publicKey === upgradeAuthority.toBase58()) }));
console.log(JSON.stringify({ programId:programId.toBase58(), programDataAddress:programDataAddress.toBase58(), upgradeAuthority:upgradeAuthority?.toBase58() || null, authorityAvailable:deduped.some(row => row.matchesUpgradeAuthority), candidates:deduped }, null, 2));
