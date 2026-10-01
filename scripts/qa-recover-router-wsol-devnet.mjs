import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { verifyWrappedSolRecoveryReceipt } from '../server/wrapped-sol-recovery-receipt.mjs';

assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL, 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const mint = new PublicKey('FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH');
const router = new PublicKey('5fbyRAEDqWqvq5Abbqw7NJpGF6fmLJjbEM1oesx7LRpy');
const programId = new PublicKey('2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const authority = Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || ''));
const payer = Keypair.fromSecretKey(bs58.decode(process.env.QA_DEVNET_PUMP_FEE_KEEPER_SECRET_KEY || ''));
assert.equal(authority.publicKey.toBase58(), '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
assert.equal(payer.publicKey.toBase58(), '3nA4cRAKSXBupbRQ9gcktV7VkDL1E2Wn48VpjXMkp7Bm');
const [expectedRouter] = PublicKey.findProgramAddressSync([Buffer.from('funded-mint-router-v2'), mint.toBuffer()], programId);
assert(expectedRouter.equals(router));
const ata = getAssociatedTokenAddressSync(NATIVE_MINT, router, true);
const account = await connection.getParsedAccountInfo(ata, 'finalized');
assert(account.value, 'Router wrapped SOL account has already been closed.');
assert.equal(account.value.data.parsed.info.owner, router.toBase58());
assert.equal(account.value.data.parsed.info.mint, NATIVE_MINT.toBase58());
const amount = Number(account.value.data.parsed.info.tokenAmount.amount);
assert(amount > 0 && amount <= 20_000_000, 'Wrapped SOL recovery exceeds reviewed QA cap.');
const instruction = new TransactionInstruction({ programId, keys:[
  { pubkey:authority.publicKey, isSigner:true, isWritable:false },
  { pubkey:mint, isSigner:false, isWritable:false },
  { pubkey:router, isSigner:false, isWritable:true },
  { pubkey:ata, isSigner:false, isWritable:true },
  { pubkey:TOKEN_PROGRAM_ID, isSigner:false, isWritable:false },
], data:createHash('sha256').update('global:recover_mint_wrapped_sol').digest().subarray(0, 8) });
const transaction = new Transaction().add(instruction);
transaction.feePayer = payer.publicKey;
const simulation = await connection.simulateTransaction(transaction, [payer, authority]);
assert.equal(simulation.value.err, null, `Recovery simulation failed: ${JSON.stringify(simulation.value.err)}`);
const signature = await sendAndConfirmTransaction(connection, transaction, [payer, authority], { commitment:'finalized' });
const confirmed = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
const proof = verifyWrappedSolRecoveryReceipt({ transaction:confirmed, signature, mint:mint.toBase58(),
  router:router.toBase58(), programId:programId.toBase58() });
assert(proof && proof.collectedLamports === amount, 'Finalized recovery proof differs from preflight amount.');
assert.equal((await connection.getAccountInfo(ata, 'finalized')), null, 'Router wrapped SOL account remains open.');
const token = readFileSync('.secrets/funded-api-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8788/api/keeper/reconcile-wrapped-sol', {
  method:'POST', headers:{ origin:'https://funded.vip', authorization:`Bearer ${token}`, 'content-type':'application/json' },
  body:JSON.stringify({ mint:mint.toBase58(), signature }), signal:AbortSignal.timeout(30_000),
});
const receipt = await response.json();
assert(response.ok, `Recovery finalized but ledger reconciliation failed: ${response.status} ${receipt.error || ''}`);
assert.equal(receipt.collectedLamports, proof.collectedLamports);
assert.equal(receipt.rentRefundLamports, proof.rentRefundLamports);
console.log(JSON.stringify({ proof, reconciled:true }, null, 2));
