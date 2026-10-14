import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { deriveMintPolicyV3 } from '../mint-router-v3.js';
import { latestUnindexedV3Burn } from '../server/v3-buyback-chain-history.mjs';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const program = key(1), mint = key(2), creator = key(3), authority = key(4);
const id = Buffer.alloc(32, 9);
const receipt = PublicKey.findProgramAddressSync([
  Buffer.from('mint-buyback-v3'), mint.toBuffer(), id,
], program)[0];
const signature = '3'.repeat(64);
const receiptData = Buffer.alloc(160);
createHash('sha256').update('account:MintBuybackV3').digest().copy(receiptData, 0, 0, 8);
id.copy(receiptData, 8);
mint.toBuffer().copy(receiptData, 40);
receiptData.writeBigInt64LE(1_760_000_000n, 152);
const policy = Buffer.alloc(249);
Buffer.from('25d0c7eca736c38f', 'hex').copy(policy);
mint.toBuffer().copy(policy, 8);
creator.toBuffer().copy(policy, 40);
authority.toBuffer().copy(policy, 72);
const instruction = Buffer.alloc(64);
createHash('sha256').update('global:buyback_mint_v3').digest().copy(instruction, 0, 0, 8);
id.copy(instruction, 8);
instruction.writeBigUInt64LE(100_000n, 40);
instruction.writeBigUInt64LE(500n, 48);
instruction.writeBigUInt64LE(120_000n, 56);
const accounts = Array.from({ length:41 }, (_, index) => key(index + 10));
accounts[0] = authority;
accounts[1] = creator;
accounts[2] = mint;
accounts[10] = receipt;
const messageKeys = [program, ...accounts];
const connection = {
  getProgramAccounts:async () => [{ pubkey:receipt,
    account:{ owner:program, data:receiptData } }],
  getAccountInfo:async address => address.equals(deriveMintPolicyV3(program, mint).address)
    ? { owner:program, data:policy } : null,
  getSignaturesForAddress:async () => [{ signature, err:null,
    confirmationStatus:'finalized' }],
  getTransaction:async () => ({ meta:{ err:null }, transaction:{ message:{
    accountKeys:messageKeys, instructions:[{ programIdIndex:0,
      accounts:accounts.map((_, index) => index + 1), data:instruction }],
  } } }),
};

test('unindexed burn history requires a derived receipt and a full finalized proof', async () => {
  const proof = await latestUnindexedV3Burn({ connection, programId:program,
    verifyBurn:async args => {
      assert.equal(args.sourceMint.toBase58(), mint.toBase58());
      assert.equal(args.creator.toBase58(), creator.toBase58());
      assert.equal(args.initialAuthority.toBase58(), authority.toBase58());
      assert.equal(args.spendableQuoteIn, 100_000n);
      assert.equal(args.maxTotalDebit, 120_000n);
      return { finalized:true, receipt:receipt.toBase58(), signature,
        slot:123, burnedAt:'2026-10-14T00:00:00.000Z' };
    } });
  assert.equal(proof.source, 'onchain-unindexed');
  assert.equal(proof.signature, signature);
  assert.equal(await latestUnindexedV3Burn({ connection, programId:program,
    verifyBurn:async () => null }), null);
  assert.equal(await latestUnindexedV3Burn({ connection, programId:program,
    indexedSignatures:new Set([signature]), verifyBurn:async () => {
      throw new Error('Indexed burn must not be rediscovered');
    } }), null);
  assert.equal(await latestUnindexedV3Burn({
    connection:{ ...connection, getProgramAccounts:async () => [{
      pubkey:key(99), account:{ owner:program, data:receiptData },
    }] }, programId:program, verifyBurn:async () => {
      throw new Error('Forged PDA must not be considered');
    } }), null);
});
