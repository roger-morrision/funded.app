import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { buildTokenConversionInstruction, decodeSolCreditV3, deriveSolCreditV3, tokenDiscriminators } from '../mint-router-v3-token.js';
import { TOKEN_CONVERSION_POOLS, readDirectedTokenBudget } from '../server/v3-token-keeper.mjs';
import { decodePumpTrades } from '../server/coin-market.mjs';

const PROGRAM = new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const PUMP_SWAP = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const anchor = name => createHash('sha256').update(name).digest('hex').slice(0, 16);

test('conversion discriminators match the router program', () => {
  assert.equal(tokenDiscriminators.convert_token_budget_v3, anchor('global:convert_token_budget_v3'));
  assert.equal(tokenDiscriminators.MintSolCreditV3, anchor('account:MintSolCreditV3'));
});

test('conversion instruction encodes category, amounts and the PumpSwap accounts', () => {
  const mint = Keypair.generate().publicKey, authority = Keypair.generate().publicKey;
  const pump = new TransactionInstruction({ programId: PUMP_SWAP, data: Buffer.alloc(25),
    keys: Array.from({ length: 25 }, (_, index) => ({ pubkey: Keypair.generate().publicKey, isSigner: index === 1, isWritable: index === 5 })) });
  const id = Buffer.alloc(32, 7);
  const { instruction, vault } = buildTokenConversionInstruction({ programId: PROGRAM, mint, quoteMint: USDC, quoteTokenProgram: TOKEN,
    authority, conversionId: id, category: 6, amountIn: 643n, minSolOut: 6197n, pumpBuyInstruction: pump });
  assert.equal(instruction.keys.length, 16 + 25);
  assert.equal(instruction.data.subarray(0, 8).toString('hex'), tokenDiscriminators.convert_token_budget_v3);
  assert.deepEqual(instruction.data.subarray(8, 40), id);
  assert.equal(instruction.data[40], 6);
  assert.equal(instruction.data.readBigUInt64LE(41), 643n);
  assert.equal(instruction.data.readBigUInt64LE(49), 6197n);
  assert.ok(instruction.keys[0].isSigner && instruction.keys[0].pubkey.equals(authority));
  assert.ok(instruction.keys[6].pubkey.equals(vault));
  assert.ok(instruction.keys[9].pubkey.equals(deriveSolCreditV3(PROGRAM, mint)));
  // The vault (PumpSwap user) signs through the router, never in the outer transaction.
  assert.ok(instruction.keys.slice(16).every(row => !row.isSigner));
  assert.ok(instruction.keys[17].isWritable);
});

test('only buyback and agency budgets convert', () => {
  const pump = new TransactionInstruction({ programId: PUMP_SWAP, data: Buffer.alloc(25), keys: [] });
  for (const category of [0, 1, 5])
    assert.throws(() => buildTokenConversionInstruction({ programId: PROGRAM, mint: USDC, quoteMint: USDC, quoteTokenProgram: TOKEN,
      authority: USDC, conversionId: Buffer.alloc(32), category, amountIn: 1n, minSolOut: 1n, pumpBuyInstruction: pump }), /buyback \(6\)/);
});

test('Mainnet has no conversion pool until one is reviewed', () => {
  assert.deepEqual(Object.keys(TOKEN_CONVERSION_POOLS['mainnet-beta']), []);
  assert.equal(TOKEN_CONVERSION_POOLS.devnet[USDC.toBase58()], 'BT8wc5m9pkTQ1wwVYTzsqrBwSYWxuPEQ4t8ZwHcwd7SR');
});

test('SOL credit records decode per category', () => {
  const data = Buffer.alloc(8 + 32 + 64 + 1);
  Buffer.from(tokenDiscriminators.MintSolCreditV3, 'hex').copy(data);
  USDC.toBuffer().copy(data, 8);
  data.writeBigUInt64LE(6389n, 40 + 6 * 8);
  data.writeBigUInt64LE(2539n, 40 + 7 * 8);
  const record = decodeSolCreditV3(data);
  assert.equal(record.mint, USDC.toBase58());
  assert.deepEqual(record.credited.slice(6), [6389n, 2539n]);
  assert.throws(() => decodeSolCreditV3(Buffer.alloc(10)), /Invalid SOL credit/);
});

test('directed budget splits category 0 by the policy units and subtracts releases', async () => {
  const mint = Keypair.generate().publicKey;
  const policy = Buffer.alloc(8 + 96 + 28 + 8 + 128 + 12);
  [4_000_000, 4_000_000, 0].forEach((unit, index) => policy.writeUInt32LE(unit, 8 + 96 + 28 + 8 + 128 + index * 4));
  const ledger = Buffer.alloc(8 + 32 + 32 + 8 + 64 + 64 + 24 + 1);
  Buffer.from(tokenDiscriminators.MintTokenLedgerV3, 'hex').copy(ledger);
  mint.toBuffer().copy(ledger, 8); USDC.toBuffer().copy(ledger, 40);
  ledger.writeBigUInt64LE(10_000n, 80 + 0); // paid[0]
  ledger.writeBigUInt64LE(1_000n, 80 + 64 + 64 + 0); // released[0]
  const connection = { getMultipleAccountsInfo: async () => [{ owner: PROGRAM, data: policy }, { owner: PROGRAM, data: ledger }] };
  const budget = await readDirectedTokenBudget({ connection, programId: PROGRAM, mint, quoteMint: USDC });
  assert.deepEqual(budget.targets, [5_000n, 5_000n, 0n]);
  assert.deepEqual(budget.owed, [4_000n, 5_000n, 0n]);
  assert.equal(budget.available, 10_000n);
});

test('launch checks may decode paired-token Pump trades; market views stay SOL-only', () => {
  assert.deepEqual(decodePumpTrades(['Program log: unrelated'], USDC, { anyQuote: true }), []);
});

test('agency policy verification counts SOL credited by token conversions', async () => {
  const { readFileSync } = await import('node:fs');
  const { decodeAgencyPolicyV3, readSolCreditLamportsV3 } = await import('../agency-mint-router-v3.js');
  // Real Devnet accounts after converting G4th's buyback (6) and agency (7) USDC budgets.
  const fx = JSON.parse(readFileSync(new URL('./fixtures/devnet-paired-agency-policy.json', import.meta.url)));
  const program = new PublicKey(fx.programId);
  const account = { owner: program, executable: false, data: Buffer.from(fx.policy, 'base64') };
  const creditInfo = { owner: program, executable: false, data: Buffer.from(fx.credit, 'base64') };
  const base = { programId: fx.programId, mint: fx.mint, creator: fx.creator, initialAuthority: fx.initialAuthority };
  assert.throws(() => decodeAgencyPolicyV3(account, base), /released counters differ/);
  const credited = await readSolCreditLamportsV3({ getAccountInfo: async () => creditInfo }, fx.programId, fx.mint);
  assert.ok(credited[6] > 0n && credited[7] > 0n);
  const policy = decodeAgencyPolicyV3(account, { ...base, credited });
  assert.equal(policy.verified, true);
  assert.ok(policy.paidLamports[6] >= credited[6] && policy.paidLamports[7] >= credited[7]);
  assert.deepEqual(await readSolCreditLamportsV3({ getAccountInfo: async () => null }, fx.programId, fx.mint), Array(8).fill(0n));
  await assert.rejects(readSolCreditLamportsV3({ getAccountInfo: async () => ({ ...creditInfo, owner: PublicKey.default }) }, fx.programId, fx.mint), /owner differs/);
});

test('agency SOL settlement carries the SOL credit record when the coin has one', async () => {
  const { v3SettlementSolCredit, settlementWithOptionalCredit } = await import('../server/v3-policy-builders.mjs');
  const split = { operationsPercent: 40, referralLevelPercents: [3, 1.25, 0.75], communityPercent: 20, buybackPercent: 25, agencyPercent: 10 };
  const mint = Keypair.generate().publicKey, credit = deriveSolCreditV3(PROGRAM, mint);
  const present = { getAccountInfo: async address => address.equals(credit) ? { owner: PROGRAM } : null };
  assert.ok((await v3SettlementSolCredit({ connection: present, programId: PROGRAM, mint, split })).equals(credit));
  assert.equal(await v3SettlementSolCredit({ connection: { getAccountInfo: async () => null }, programId: PROGRAM, mint, split }), null);
  const input = { programId: PROGRAM, mint, authority: Keypair.generate().publicKey, creator: Keypair.generate().publicKey,
    claimId: Buffer.alloc(32, 1), expectedLamports: 1000n, split };
  const plain = settlementWithOptionalCredit(input, 0).instruction.keys;
  const withCredit = settlementWithOptionalCredit(input, plain.length + 1).instruction.keys;
  assert.equal(withCredit.length, plain.length + 1);
  assert.ok(withCredit.at(-1).pubkey.equals(credit) && !withCredit.at(-1).isWritable);
});

test('settlement position serves only the policy from its snapshot; other reads go to the chain', async () => {
  const { loadV3SettlementPosition } = await import('../server/v3-settlement-position.mjs');
  const { deriveAgencyPolicyV3 } = await import('../agency-mint-router-v3.js');
  const mint = Keypair.generate().publicKey, other = Keypair.generate().publicKey;
  const split = { operationsPercent: 40, referralLevelPercents: [3, 1.25, 0.75], communityPercent: 20, buybackPercent: 25, agencyPercent: 10 };
  const policyAddress = deriveAgencyPolicyV3(PROGRAM, mint).address, snapshotValue = { owner: PROGRAM, data: Buffer.alloc(1) };
  const connection = { getAccountInfoAndContext: async () => ({ value: snapshotValue, context: { slot: 10 } }), getAccountInfo: async () => 'live' };
  let seen;
  await assert.rejects(loadV3SettlementPosition({ connection, signature: 's', slot: 5, programId: PROGRAM, mint, authority: other, creator: other,
    expectedLamports: 1n, categoryLamports: [], split, verifyPolicy: async ({ connection: c }) => {
      seen = [await c.getAccountInfo(policyAddress), await c.getAccountInfo(other)]; return { verified: false }; } }), /snapshot is invalid/);
  assert.equal(seen[0], snapshotValue);
  assert.equal(seen[1], 'live');
});
