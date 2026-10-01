import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { verifyWrappedSolRecoveryReceipt } from '../server/wrapped-sol-recovery-receipt.mjs';
import { verifyCollectionReceipt } from '../server/receipt-evidence.mjs';

const mint = 'FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH';
const router = '5fbyRAEDqWqvq5Abbqw7NJpGF6fmLJjbEM1oesx7LRpy';
const programId = '2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik';
const signature = '1'.repeat(64);
const ata = getAssociatedTokenAddressSync(NATIVE_MINT, new PublicKey(router), true).toBase58();
const keys = [router, ata, programId, mint, TOKEN_PROGRAM_ID.toBase58(), '11111111111111111111111111111111'].map(x => new PublicKey(x));
const data = bs58.encode(createHash('sha256').update('global:recover_mint_wrapped_sol').digest().subarray(0, 8));
const transaction = { slot:123, blockTime:1, transaction:{ signatures:[signature], message:{ accountKeys:keys,
  instructions:[{ programIdIndex:2, accounts:[5, 3, 0, 1, 4], data }] } }, meta:{ err:null,
  preBalances:[1_000_000, 13_268_689, 0, 0, 0, 100], postBalances:[14_268_689, 0, 0, 0, 0, 95],
  preTokenBalances:[{ accountIndex:1, mint:NATIVE_MINT.toBase58(), owner:router, uiTokenAmount:{ amount:'11780249' } }],
  postTokenBalances:[] } };
const input = { transaction, signature, mint, router, programId };
const proof = verifyWrappedSolRecoveryReceipt(input);
assert.equal(proof.collectedLamports, 11_780_249);
assert.equal(proof.rentRefundLamports, 1_488_440);
const record = { ...proof, programId, cluster:'devnet', status:'collected', attribution:'mint-verified',
  onchainVerified:true, collectionMethod:'wrapped-sol-recovery' };
assert(verifyCollectionReceipt(record, transaction));
assert.equal(verifyCollectionReceipt({ ...record, collectedLamports:13_268_689 }, transaction), null);
assert.equal(verifyCollectionReceipt({ ...record, rentRefundLamports:0 }, transaction), null);
assert.equal(verifyWrappedSolRecoveryReceipt({ ...input, transaction:{ ...transaction, meta:{ ...transaction.meta,
  postBalances:[14_268_688, 1, 0, 0, 0, 95] } } }), null);
assert.equal(verifyWrappedSolRecoveryReceipt({ ...input, transaction:{ ...transaction, transaction:{ ...transaction.transaction,
  message:{ ...transaction.transaction.message, instructions:[{ ...transaction.transaction.message.instructions[0], data:'11111111' }] } } } }), null);
console.log('wrapped SOL receipt: exact fee, rent, closure, router and instruction verified');
