import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { deriveMintVaultsV3 } from '../mint-router-v3.js';
import { buildV3BuybackInstruction,
  V3_DEVNET_FUNDED_MINT, V3_DEVNET_FUNDED_POOL } from '../server/v3-buyback-instruction.mjs';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte));
const program = key(52).publicKey, sourceMint = key(53).publicKey;
const authority = key(54).publicKey, creator = key(55).publicKey;

function fixture() {
  const vault = deriveMintVaultsV3(program, sourceMint)[6];
  const fundedAta = getAssociatedTokenAddressSync(V3_DEVNET_FUNDED_MINT,
    vault, true, TOKEN_PROGRAM_ID);
  const quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT, vault, true,
    TOKEN_PROGRAM_ID);
  const addresses = Array.from({ length:23 }, (_, index) =>
    key(index + 60).publicKey);
  addresses.push(key(83).publicKey, key(84).publicKey);
  for (const [index, address] of [
    [0, V3_DEVNET_FUNDED_POOL], [1, vault],
    [3, V3_DEVNET_FUNDED_MINT], [4, NATIVE_MINT],
    [5, fundedAta], [6, quoteAta], [11, TOKEN_PROGRAM_ID],
    [12, TOKEN_PROGRAM_ID], [13, SystemProgram.programId],
    [14, ASSOCIATED_TOKEN_PROGRAM_ID], [16, PUMP_AMM_PROGRAM_ID],
  ]) addresses[index] = address;
  const pumpBuyInstruction = new TransactionInstruction({
    programId:PUMP_AMM_PROGRAM_ID,
    data:Buffer.from([102, 6, 61, 18, 1, 218, 235, 234, 0]),
    keys:addresses.map((pubkey, index) => ({ pubkey,
      isSigner:index === 1, isWritable:[0, 1, 5, 6].includes(index) })),
  });
  return { programId:program, sourceMint, authority, creator,
    baseTokenProgram:TOKEN_PROGRAM_ID,
    buybackId:Buffer.alloc(32, 7), spendableQuoteIn:'1000000',
    minBaseAmountOut:'500', maxTotalDebit:'2000000', pumpBuyInstruction };
}

test('V3 buyback instruction binds the source category vault to the funded pool', () => {
  const built = buildV3BuybackInstruction(fixture());
  assert.equal(built.instruction.keys[5].pubkey.toBase58(), built.vault.toBase58());
  assert.equal(built.instruction.keys[9].pubkey.toBase58(),
    V3_DEVNET_FUNDED_POOL.toBase58());
  assert.equal(built.instruction.keys[16 + 1].pubkey.toBase58(),
    built.vault.toBase58());
  assert.equal(built.instruction.keys[16 + 1].isSigner, false,
    'Only the router program may sign for the category vault PDA.');
  assert.equal(built.instruction.data.readBigUInt64LE(40), 1_000_000n);
  assert.equal(built.instruction.data.readBigUInt64LE(48), 500n);
  assert.equal(built.instruction.data.readBigUInt64LE(56), 2_000_000n);
});

test('V3 buyback rejects a substituted pool, token account, or excess quote', () => {
  const changed = fixture();
  changed.pumpBuyInstruction.keys[0].pubkey = PublicKey.unique();
  assert.throws(() => buildV3BuybackInstruction(changed), /approved Devnet market/);
  const wrongAta = fixture();
  wrongAta.pumpBuyInstruction.keys[5].pubkey = PublicKey.unique();
  assert.throws(() => buildV3BuybackInstruction(wrongAta), /approved Devnet market/);
  const extra = fixture();
  extra.pumpBuyInstruction.keys.push(...extra.pumpBuyInstruction.keys.slice(22, 25));
  assert.throws(() => buildV3BuybackInstruction(extra), /approved Devnet market/);
  assert.throws(() => buildV3BuybackInstruction({ ...fixture(),
    maxTotalDebit:'999999' }), /lower than/);
});
