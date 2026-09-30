import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

const PROGRAM = new PublicKey('2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const OLD = 'B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n';
const NEW = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
const OWNER = '3NMjsHsau8uw598UKZqbKq8dhFjGMEYpdx5wU72Kfh1P';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const buildPath = new URL('../contracts/funded-fee-router/target/deploy/funded_fee_router.so', import.meta.url);
const connection = new Connection(process.env.SOLANA_RPC_URL, 'finalized');

function signer(env, expected) {
  const keypair = Keypair.fromSecretKey(bs58.decode(process.env[env] || ''));
  assert.equal(keypair.publicKey.toBase58(), expected, `${env} does not match the reviewed public key`);
  return keypair;
}

const old = signer('RETIRED_DEVNET_ROUTER_SECRET_KEY', OLD);
const next = signer('QA_DEVNET_ROUTER_AUTHORITY_SECRET_KEY', NEW);
const owner = signer('QA_DEVNET_APP_OWNER_SECRET_KEY', OWNER);
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS, 'Devnet only');
const program = await connection.getAccountInfo(PROGRAM, 'finalized');
assert(program?.executable && program.data.readUInt32LE(0) === 2, 'Upgradeable program expected');
const programDataAddress = new PublicKey(program.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataAddress, 'finalized');
assert(programData?.data.readUInt32LE(0) === 3 && programData.data[12] === 1, 'Upgradeable ProgramData expected');
assert.equal(new PublicKey(programData.data.subarray(13, 45)).toBase58(), OWNER, 'App owner is not the upgrade authority');
const binary = await readFile(buildPath);
assert(programData.data.subarray(45, 45 + binary.length).equals(binary), 'Deployed Devnet binary does not match the reviewed local build');
const [legacy] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], PROGRAM);
const routers = await connection.getProgramAccounts(PROGRAM, { commitment: 'finalized', filters: [{ dataSize: 106 }] });
assert(routers.length >= 19, 'Expected at least the 19 audited mint routers');

function headerAuthority(account, size, magic) {
  assert(account?.owner.equals(PROGRAM) && account.data.length === size, 'Router account shape mismatch');
  assert.equal(account.data.subarray(0, 8).toString(), magic, 'Router magic mismatch');
  return new PublicKey(account.data.subarray(41, 73)).toBase58();
}

async function current() {
  const legacyInfo = await connection.getAccountInfo(legacy, 'finalized');
  const legacyAuthority = headerAuthority(legacyInfo, 74, 'FUNDFEE1');
  assert([OLD, NEW].includes(legacyAuthority), 'Unexpected legacy authority');
  const rows = await connection.getProgramAccounts(PROGRAM, { commitment: 'finalized', filters: [{ dataSize: 106 }] });
  const pending = [];
  for (const row of rows) {
    const authority = headerAuthority(row.account, 106, 'FUNDMNT2');
    assert([OLD, NEW].includes(authority), `Unexpected authority at ${row.pubkey}`);
    const mint = new PublicKey(row.account.data.subarray(73, 105));
    const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from('funded-mint-router-v2'), mint.toBuffer()], PROGRAM);
    assert(row.pubkey.equals(expected) && row.account.data[105] === bump, 'Mint router PDA mismatch');
    if (authority === OLD) pending.push(row.pubkey);
  }
  return { legacyAuthority, pending, total: rows.length };
}

const rotate = createHash('sha256').update('global:rotate_authority').digest().subarray(0, 8);
let state = await current();
const signatures = [];
for (let offset = 0; offset < state.pending.length; offset += 8) {
  const group = state.pending.slice(offset, offset + 8);
  const instruction = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: old.publicKey, isSigner: true, isWritable: true },
      { pubkey: next.publicKey, isSigner: true, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: legacy, isSigner: false, isWritable: true },
      { pubkey: PROGRAM, isSigner: false, isWritable: false },
      { pubkey: programDataAddress, isSigner: false, isWritable: false },
      ...group.map(pubkey => ({ pubkey, isSigner: false, isWritable: true })),
    ],
    data: rotate,
  });
  const blockhash = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ feePayer: old.publicKey, recentBlockhash: blockhash.blockhash }).add(instruction);
  transaction.sign(old, next, owner);
  const serialized = transaction.serialize();
  assert(serialized.length <= 1232, 'Rotation transaction exceeds packet size');
  const signature = await connection.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: 'confirmed' });
  const confirmation = await connection.confirmTransaction({ signature, ...blockhash }, 'finalized');
  assert.equal(confirmation.value.err, null, `Rotation transaction ${signature} failed`);
  signatures.push(signature);
  console.log(JSON.stringify({ rotatedInBatch: group.length, signature }));
}
state = await current();
assert.equal(state.legacyAuthority, NEW, 'Legacy authority was not rotated');
assert.equal(state.pending.length, 0, 'Some mint routers retain the old authority');
console.log(JSON.stringify({ program: PROGRAM.toBase58(), upgradeAuthority: OWNER, routerAuthority: NEW, mintRoutersVerified: state.total, signatures }));
