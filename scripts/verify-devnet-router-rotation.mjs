import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

const program = new PublicKey('2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const old = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const next = new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const owner = '3NMjsHsau8uw598UKZqbKq8dhFjGMEYpdx5wU72Kfh1P';
assert.equal(old.publicKey.toBase58(), 'B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n');
const connection = new Connection(process.env.SOLANA_RPC_URL, 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const executable = await connection.getAccountInfo(program, 'finalized');
assert(executable?.executable && executable.data.readUInt32LE(0) === 2);
const programData = await connection.getAccountInfo(new PublicKey(executable.data.subarray(4, 36)), 'finalized');
assert.equal(new PublicKey(programData.data.subarray(13, 45)).toBase58(), owner);
const binary = await readFile(new URL('../contracts/funded-fee-router/target/deploy/funded_fee_router.so', import.meta.url));
assert(programData.data.subarray(45, 45 + binary.length).equals(binary), 'Deployed binary differs from reviewed build');
const [legacy] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], program);
const legacyInfo = await connection.getAccountInfo(legacy, 'finalized');
assert.equal(new PublicKey(legacyInfo.data.subarray(41, 73)).toBase58(), next.toBase58());
const routers = await connection.getProgramAccounts(program, { commitment: 'finalized', filters: [{ dataSize: 106 }] });
assert(routers.length >= 19);
for (const row of routers) assert.equal(new PublicKey(row.account.data.subarray(41, 73)).toBase58(), next.toBase58());

// Simulate an old-authority vault creation. This sends no transaction and must fail
// at the new on-chain authority guard, even though the old wallet has SOL.
const mint = Keypair.generate().publicKey;
const [vault] = PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'), old.publicKey.toBuffer(), mint.toBuffer()], program);
const instruction = new TransactionInstruction({
  programId: program,
  keys: [
    { pubkey: old.publicKey, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: legacy, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: createHash('sha256').update('global:initialize_reward_vault').digest().subarray(0, 8),
});
const blockhash = await connection.getLatestBlockhash('finalized');
const tx = new Transaction({ feePayer: old.publicKey, recentBlockhash: blockhash.blockhash }).add(instruction);
tx.sign(old);
const simulated = await connection.simulateTransaction(tx, [old]);
assert(simulated.value.err, 'Old authority unexpectedly created a new reward vault');
assert.match((simulated.value.logs || []).join('\n'), /InvalidRouterHeader|0x1771/i, 'Expected the router authority guard to reject the old key');
assert.equal(await connection.getAccountInfo(vault, 'finalized'), null, 'Simulation must not create an account');
console.log(JSON.stringify({ status: 'passed', verification: 'finalized-devnet-and-negative-simulation', program: program.toBase58(), upgradeAuthority: owner, routerAuthority: next.toBase58(), mintRouters: routers.length, oldAuthorityVaultCreation: 'rejected', programDataSha256: createHash('sha256').update(programData.data).digest('hex') }));
