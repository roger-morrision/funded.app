/** Isolated local-validator acceptance. Never accepts a public RPC endpoint. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildMintRouterInitializeInstruction } from '../mint-router-launch.js';
import { buildMintRouterSettlementInstruction } from '../server/mint-router-payout.mjs';
import { buildRewardManifest } from '../reward-merkle.js';
import { rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { verifyFeeRouterAccount, verifyMintFeeRouterAccount } from '../fee-router.js';

const rpc = new URL(process.env.LOCAL_SOLANA_RPC_URL || 'http://127.0.0.1:18899');
assert(['127.0.0.1', 'localhost'].includes(rpc.hostname), 'Only a loopback validator is permitted.');
const connection = new Connection(rpc.toString(), 'confirmed');
const genesis = await connection.getGenesisHash();
assert(!['EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'].includes(genesis), 'A fresh local ledger is required.');
const programId = new PublicKey('2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const binary = await readFile(new URL('../contracts/funded-fee-router/target/deploy/funded_fee_router.so', import.meta.url));
const executable = await connection.getAccountInfo(programId);
assert(executable?.executable && executable.data.readUInt32LE(0) === 2, 'Use --upgradeable-program with a disposable local owner.');
const programDataAddress = new PublicKey(executable.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataAddress);
assert(programData.data.subarray(45, 45 + binary.length).equals(binary), 'Local validator program differs from current built artifact.');
assert(programData.data[12] === 1, 'Local fixture requires an upgrade authority.');
assert(process.env.LOCAL_TEST_UPGRADE_AUTHORITY_FILE, 'An explicit disposable local upgrade-authority keyfile is required.');
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(process.env.LOCAL_TEST_UPGRADE_AUTHORITY_FILE, 'utf8'))));
assert(new PublicKey(programData.data.subarray(13, 45)).equals(owner.publicKey), 'Local owner fixture differs from program authority.');
const authority = Keypair.generate(), next = Keypair.generate(), stranger = Keypair.generate(), mint = Keypair.generate();
const recipientA = Keypair.generate().publicKey, recipientB = Keypair.generate().publicKey;
const evidence = { schemaVersion: 1, network: 'isolated-local-validator', genesis, startedAt: new Date().toISOString(),
  program: programId.toBase58(), artifactSha256: createHash('sha256').update(binary).digest('hex'),
  transactions: [], checks: [], limitations: ['This is local validator evidence, not Devnet or Mainnet.', 'Root creation and settlement recipients remain operator controlled; no independent audit is implied.'] };
const digest = value => createHash('sha256').update(value).digest().subarray(0, 8);
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const integer = (value, width = 8) => { const result = Buffer.alloc(width); width === 4 ? result.writeUInt32LE(Number(value)) : result.writeBigUInt64LE(BigInt(value)); return result; };
const ix = (name, keys, data = []) => new TransactionInstruction({ programId, keys, data: Buffer.concat([digest(`global:${name}`), ...data]) });
async function send(name, instructions, signers = [authority]) {
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(...[].concat(instructions)), signers,
    { commitment: 'confirmed', preflightCommitment: 'confirmed' });
  evidence.transactions.push({ name, signature });
  return signature;
}
async function reject(name, instruction, signers, expectedLog) {
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = signers[0].publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const result = await connection.simulateTransaction(transaction, signers);
  assert(result.value.err, `${name} unexpectedly succeeded`);
  assert.match(result.value.logs.join('\n'), expectedLog, `${name} failed for an unexpected reason`);
  evidence.checks.push({ name, passed: true, mode: 'simulation', error: result.value.err });
}
for (const wallet of [authority, next, stranger, owner]) {
  const signature = await connection.requestAirdrop(wallet.publicKey, 2_000_000_000);
  await connection.confirmTransaction(signature, 'confirmed');
  evidence.transactions.push({ name: 'local-airdrop', signature });
}
const [router] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], programId);
const mintRouter = buildMintRouterInitializeInstruction({ programId, mint: mint.publicKey, payer: authority.publicKey });
await send('prefund-global-and-mint-router', [
  SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: router, lamports: 1_000_000 }),
  SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: mintRouter.router.address, lamports: 10_000_000 }),
]);
await send('initialize-prefunded-global-router', ix('initialize', [meta(authority.publicKey, true, true), meta(router, false, true), meta(SystemProgram.programId)]));
await send('initialize-prefunded-mint-router', mintRouter.instruction, [authority, mint]);
assert((await verifyFeeRouterAccount({ connection, programId })).verified);
assert((await verifyMintFeeRouterAccount({ connection, programId, mint: mint.publicKey, expectedAuthority: authority.publicKey })).verified);
assert.equal(await connection.getBalance(router), await connection.getMinimumBalanceForRentExemption(74));
assert.equal(await connection.getBalance(mintRouter.router.address), 10_000_000);
evidence.checks.push({ name: 'prefunded-router-deposit-conservation', passed: true });
const { vault } = rewardAddresses({ programId, authority: authority.publicKey, mint: mint.publicKey });
const vaultInstruction = (signer, address) => ix('initialize_reward_vault', [meta(signer, true, true), meta(mint.publicKey), meta(address, false, true), meta(router), meta(SystemProgram.programId)]);
await send('initialize-reward-vault', vaultInstruction(authority.publicKey, vault));
const allocation = buildMintRouterSettlementInstruction({ programId, mint: mint.publicKey, authority: authority.publicKey,
  recipient: vault, amountLamports: '5000000', obligationId: 'local-lifecycle-allocation' });
await send('settle-mint-router-to-reward-vault', allocation.instruction);
await reject('settlement-replay-rejected', allocation.instruction, [authority], /already in use/);
const cycleId = createHash('sha256').update('local-lifecycle-cycle').digest('hex');
const manifest = buildRewardManifest({ cycleId, allocations: [{ recipient: recipientA, amount: '2000000' }, { recipient: recipientB, amount: '3000000' }] });
const { cycle } = rewardAddresses({ programId, authority: authority.publicKey, mint: mint.publicKey, cycleId });
const cycleInstruction = (id = cycleId, address = cycle) => ix('create_reward_cycle', [meta(authority.publicKey, true, true), meta(vault), meta(address, false, true), meta(router), meta(SystemProgram.programId)],
  [Buffer.from(id, 'hex'), Buffer.from(manifest.root, 'hex'), SystemProgram.programId.toBuffer(), integer(manifest.totalAmount), integer(1), integer(2), integer(2, 4)]);
await send('commit-reward-manifest', cycleInstruction());
const claimInstruction = (leaf, amount = leaf.amount) => {
  const { payment } = rewardAddresses({ programId, authority: authority.publicKey, mint: mint.publicKey, cycleId, recipient: leaf.recipient });
  return ix('payout_reward_sol', [meta(authority.publicKey, true, true), meta(vault, false, true), meta(cycle, false, true), meta(new PublicKey(leaf.recipient), false, true), meta(payment, false, true), meta(SystemProgram.programId)],
    [integer(amount), integer(leaf.index, 4), integer(leaf.proof.length, 4), ...leaf.proof.map(node => Buffer.from(node, 'hex'))]);
};
await reject('reward-wrong-amount-rejected', claimInstruction(manifest.leaves[0], '1999999'), [authority], /InvalidRewardProof/);
await send('claim-reward-recipient-a', claimInstruction(manifest.leaves[0]));
await reject('reward-replay-rejected', claimInstruction(manifest.leaves[0]), [authority], /already in use/);
const rotate = ownerKey => ix('rotate_authority', [meta(authority.publicKey, true), meta(next.publicKey, true), meta(ownerKey, true), meta(router, false, true), meta(programId), meta(programDataAddress), meta(mintRouter.router.address, false, true)]);
await reject('rotation-wrong-upgrade-owner-rejected', rotate(stranger.publicKey), [authority, next, stranger], /InvalidRotationAuthority/);
await send('rotate-global-and-mint-authority', rotate(owner.publicKey), [authority, next, owner]);
assert((await verifyMintFeeRouterAccount({ connection, programId, mint: mint.publicKey, expectedAuthority: next.publicKey })).verified);
assert((await verifyFeeRouterAccount({ connection, programId })).authority.equals(next.publicKey));
const newCycleId = createHash('sha256').update('local-retired-authority-cycle').digest('hex');
const newCycle = rewardAddresses({ programId, authority: authority.publicKey, mint: mint.publicKey, cycleId: newCycleId }).cycle;
await reject('retired-authority-cannot-commit-cycle', cycleInstruction(newCycleId, newCycle), [authority], /InvalidRouterHeader/);
assert.equal(await connection.getAccountInfo(newCycle), null);
const retiredAllocation = buildMintRouterSettlementInstruction({ programId, mint: mint.publicKey, authority: authority.publicKey,
  recipient: vault, amountLamports: '1000000', obligationId: 'local-retired-authority-settlement' });
await reject('retired-authority-cannot-settle', retiredAllocation.instruction, [authority], /InvalidMintRouter/);
await send('claim-committed-reward-after-rotation', claimInstruction(manifest.leaves[1]));
const newVault = rewardAddresses({ programId, authority: next.publicKey, mint: mint.publicKey }).vault;
await send('new-authority-creates-vault', vaultInstruction(next.publicKey, newVault), [next]);
assert.equal(await connection.getBalance(recipientA), 2_000_000);
assert.equal(await connection.getBalance(recipientB), 3_000_000);
assert.equal((await connection.getAccountInfo(cycle)).data.readBigUInt64LE(144), 5_000_000n);
assert.equal(await connection.getBalance(vault), await connection.getMinimumBalanceForRentExemption(73));
evidence.checks.push({ name: 'reward-conservation-and-pending-claims-survive-rotation', passed: true, recipientALamports: 2_000_000, recipientBLamports: 3_000_000, distributedLamports: 5_000_000 });
for (const receipt of evidence.transactions) {
  await connection.confirmTransaction(receipt.signature, 'finalized');
  const transaction = await connection.getTransaction(receipt.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  assert(transaction && transaction.meta?.err === null, 'Missing successful finalized local transaction');
  Object.assign(receipt, { finalized: true, slot: transaction.slot, feeLamports: transaction.meta.fee });
}
evidence.finishedAt = new Date().toISOString(); evidence.status = 'passed';
const output = resolve(process.env.LOCAL_LIFECYCLE_EVIDENCE || 'docs/audit/devnet-2026-10-04/local-router-lifecycle-acceptance.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: evidence.status, artifactSha256: evidence.artifactSha256, transactions: evidence.transactions.length, checks: evidence.checks.length, output }));
