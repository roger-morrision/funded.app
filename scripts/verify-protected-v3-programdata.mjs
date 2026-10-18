import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';

const PROGRAM = new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const AUTHORITY = new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const [binaryPath] = process.argv.slice(2);
if (!binaryPath) throw new Error('Usage: node scripts/verify-protected-v3-programdata.mjs <tested-program.so>');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL
  || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'finalized');
const [genesis, evidence] = await Promise.all([
  connection.getGenesisHash(), readProgramDataEvidence(connection, PROGRAM),
]);
const binary = readFileSync(binaryPath);
const data = evidence.programData?.data;
if (genesis !== DEVNET_GENESIS_HASH || !evidence.account?.executable
  || !data || data.length < 45 + binary.length || data.readUInt32LE(0) !== 3
  || data[12] !== 1 || !new PublicKey(data.subarray(13, 45)).equals(AUTHORITY)
  || !data.subarray(45, 45 + binary.length).equals(binary)
  || data.subarray(45 + binary.length).some(byte => byte !== 0)) {
  throw new Error('Finalized Devnet ProgramData does not match the exact tested V3 binary and authority.');
}
console.log(JSON.stringify({ status:'finalized-exact-v3-programdata',
  cluster:'devnet', program:PROGRAM.toBase58(),
  programDataAddress:evidence.programDataAddress,
  programDataSha256:evidence.sha256,
  binarySha256:createHash('sha256').update(binary).digest('hex'),
  binaryBytes:binary.length }, null, 2));
