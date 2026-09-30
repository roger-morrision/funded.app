import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { reverseReplayCommunitySnapshot, verifyPumpMigrationTransaction } from '../server/community-snapshot.mjs';

const key = () => Keypair.generate().publicKey.toBase58();
const mint = key(), ownerA = key(), ownerB = key(), accountA = key(), accountB = key();
const token = (accountIndex, owner, units) => ({ accountIndex, mint, owner, uiTokenAmount:{ amount:String(units), decimals:6 } });
const transfer = {
  transaction:{ message:{ accountKeys:[accountA, accountB] } },
  meta:{ err:null, preTokenBalances:[token(0, ownerA, 60), token(1, ownerB, 40)],
    postTokenBalances:[token(0, ownerA, 50), token(1, ownerB, 50)] },
};
const input = { mint, migrationSlot:100, migrationBlockTime:1_800_000_000, baseSlot:102,
  baseAccounts:[{ account:accountA, wallet:ownerA, balance:'50' }, { account:accountB, wallet:ownerB, balance:'50' }],
  supplyBaseUnits:'100', blockSlots:[102], blocks:new Map([[102, { transactions:[transfer] }]]) };

test('reverses every finalized token transition to the exact migration slot', () => {
  const result = reverseReplayCommunitySnapshot(input);
  assert.equal(result.coverage, 'finalized-exact-slot-v1');
  assert.deepEqual(new Map(result.accounts.map(row => [row.wallet, row.balance])), new Map([[ownerA, '60'], [ownerB, '40']]));
  assert.equal(result.supplyBaseUnits, '100');
  assert.equal(result.replayedBlocks, 1);
});

test('rejects missing blocks, incomplete metadata, divergent balances and unbounded replay', () => {
  assert.throws(() => reverseReplayCommunitySnapshot({ ...input, blocks:new Map() }), /block is missing/);
  assert.throws(() => reverseReplayCommunitySnapshot({ ...input,
    blocks:new Map([[102, { transactions:[{ ...transfer, meta:{ preTokenBalances:null, postTokenBalances:[] } }] }]]) }), /complete token-balance metadata/);
  assert.throws(() => reverseReplayCommunitySnapshot({ ...input, baseAccounts:[{ account:accountA, wallet:ownerA, balance:'51' }, { account:accountB, wallet:ownerB, balance:'49' }] }), /diverged/);
  assert.throws(() => reverseReplayCommunitySnapshot({ ...input, baseSlot:2_102 }), /bounded slot range/);
  assert.throws(() => reverseReplayCommunitySnapshot({ ...input, supplyBaseUnits:'101' }), /full eligibility supply/);
});

test('returns exact base when migration and atomic account context share a slot', () => {
  const result = reverseReplayCommunitySnapshot({ ...input, migrationSlot:102, baseSlot:102, blockSlots:[], blocks:new Map() });
  assert.deepEqual(new Map(result.accounts.map(row => [row.wallet, row.balance])), new Map([[ownerA, '50'], [ownerB, '50']]));
});

test('requires Pump migrate_v2 on the launch mint and canonical pool, including v0 loaded keys', () => {
  const launchMint = key(), pool = canonicalPumpPoolPda(new PublicKey(launchMint), NATIVE_MINT);
  const migrationData = bs58.encode(createHash('sha256').update('global:migrate_v2').digest().subarray(0, 8));
  const tradeData = bs58.encode(createHash('sha256').update('global:buy').digest().subarray(0, 8));
  const receipt = { slot:100, blockTime:1_800_000_000, meta:{ err:null,
    loadedAddresses:{ writable:[pool], readonly:[] } },
  transaction:{ message:{ staticAccountKeys:[PUMP_PROGRAM_ID, launchMint], compiledInstructions:[
    { programIdIndex:0, accounts:[1, 2], data:migrationData },
  ] } } };
  assert.equal(verifyPumpMigrationTransaction({ transaction:receipt, launchMint }).pool.toBase58(), pool.toBase58());
  const altered = patch => ({ ...receipt, meta:{ ...receipt.meta, loadedAddresses:{ ...receipt.meta.loadedAddresses } },
    transaction:{ message:{ ...receipt.transaction.message, compiledInstructions:[{
      ...receipt.transaction.message.compiledInstructions[0], ...patch,
    }] } } });
  const ordinaryTrade = altered({ data:tradeData });
  assert.throws(() => verifyPumpMigrationTransaction({ transaction:ordinaryTrade, launchMint }), /migrate_v2/);
  const wrongAccounts = altered({ accounts:[0, 1] });
  assert.throws(() => verifyPumpMigrationTransaction({ transaction:wrongAccounts, launchMint }), /canonical pool/);
  const unresolved = altered({});
  unresolved.meta.loadedAddresses = { writable:[], readonly:[] };
  assert.throws(() => verifyPumpMigrationTransaction({ transaction:unresolved, launchMint }), /canonical pool/);
});
