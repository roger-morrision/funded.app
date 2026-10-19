import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { buildMintRouterV3SettlementInstruction } from '../mint-router-v3.js';
import { loadFinalizedV3Settlement } from '../server/v3-settlement-proof.mjs';

test('V3 settlement proof binds signed instruction, exact router debit, claim and policy', async () => {
  const programId = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const claimId = Buffer.alloc(32, 7);
  const signature = '1'.repeat(64);
  const built = buildMintRouterV3SettlementInstruction({ programId, mint,
    authority, creator, claimId, expectedLamports:30n });
  const message = new Transaction({ feePayer:authority,
    recentBlockhash:Keypair.generate().publicKey.toBase58() }).add(built.instruction).compileMessage();
  const keys = message.accountKeys.map(key => key.toBase58());
  const routerIndex = keys.indexOf(built.router.address.toBase58());
  const before = keys.map(() => 0);
  const after = keys.map(() => 0);
  before[routerIndex] = 100;
  after[routerIndex] = 70;
  const tx = { slot:42, meta:{ err:null, preBalances:before, postBalances:after },
    transaction:{ signatures:[signature], message } };
  const connection = { getTransaction:async () => tx };
  const input = { connection, signature, programId, mint, authority, creator, claimId,
    expectedLamports:30n, split:{ operationsPercent:50, referralLevelPercents:[10,3,2],
      communityPercent:10, buybackPercent:25 },
    verifyClaim:async () => ({ verified:true, address:built.claim,
      categoryLamports:[24n, 3n, 1n, 1n, 0n, 1n, 0n] }),
    verifyPolicy:async () => ({ verified:true, address:built.policy.address,
      settledLamports:30n }) };
  const proof = await loadFinalizedV3Settlement(input);
  assert.equal(proof.signature, signature);
  assert.equal(proof.router, built.router.address.toBase58());
  assert.deepEqual(proof.categoryLamports, ['24','3','1','1','0','1','0']);
  // Unrelated router funds stay outside the collection proof and fee split.
  tx.meta.preBalances[routerIndex] += 600_000;
  tx.meta.postBalances[routerIndex] += 600_000;
  assert.equal((await loadFinalizedV3Settlement(input)).expectedLamports, '30');
  tx.meta.preBalances[routerIndex] = 100;
  tx.meta.postBalances[routerIndex] = 70;
  tx.meta.postBalances[routerIndex] = 71;
  assert.equal(await loadFinalizedV3Settlement(input), null);
  tx.meta.postBalances[routerIndex] = 70;
  tx.transaction.message.instructions[0].programIdIndex = keys.indexOf(creator.toBase58());
  assert.equal(await loadFinalizedV3Settlement(input), null);
});
