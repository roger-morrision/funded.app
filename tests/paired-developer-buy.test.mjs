import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, bondingCurvePda } from '@pump-fun/pump-sdk';
import { developerLockAddresses, developerLockInstruction } from '../developer-token-lock.js';
import { verifyPairedDeveloperBuy } from '../server/paired-developer-buy.mjs';

const PROGRAM = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
const QUOTE = 'launch_service_1794588200825_1c99404815b9d0d4';

function fixture({ amount = 44_000_000_000_000n, creatorKeeps = 0n, extraProgram = null, slot = 1100, lockSeconds = 43200, escrowed = amount } = {}) {
  const mint = Keypair.generate().publicKey, creator = Keypair.generate().publicKey;
  const addresses = developerLockAddresses({ mint, creator, programId: PROGRAM });
  const lock = developerLockInstruction({ mint, creator, amount: escrowed, quoteId: QUOTE, programId: PROGRAM, lockSeconds }).instruction;
  const curve = bondingCurvePda(mint).toBase58();
  const keys = [creator.toBase58(), ...lock.keys.slice(1).map(k => k.pubkey.toBase58()), PROGRAM, PUMP_PROGRAM_ID.toBase58(), ComputeBudgetProgram.programId.toBase58()];
  if (extraProgram) keys.push(extraProgram);
  const indexOf = address => { let i = keys.indexOf(address); if (i < 0) { keys.push(address); i = keys.length - 1; } return i; };
  const instructions = [
    { programIdIndex: indexOf(ComputeBudgetProgram.programId.toBase58()), accountKeyIndexes: [], data: Buffer.from([2, 0, 0, 0, 0]) },
    { programIdIndex: indexOf(PUMP_PROGRAM_ID.toBase58()), accountKeyIndexes: [0], data: Buffer.alloc(8) },
    { programIdIndex: indexOf(PROGRAM), accountKeyIndexes: lock.keys.map(k => indexOf(k.pubkey.toBase58())), data: lock.data },
    ...(extraProgram ? [{ programIdIndex: indexOf(extraProgram), accountKeyIndexes: [], data: Buffer.alloc(1) }] : []),
  ];
  indexOf(addresses.lock.toBase58());
  const row = (owner, value) => ({ mint: mint.toBase58(), owner, uiTokenAmount: { amount: String(value) } });
  const preBalances = keys.map(() => 1), postBalances = keys.map(() => 1);
  preBalances[keys.indexOf(addresses.lock.toBase58())] = 0;
  const tx = { slot, blockTime: 1_800_000_000, transaction: { signatures: ['buy-sig'], message: { staticAccountKeys: keys.map(k => new PublicKey(k)), compiledInstructions: instructions } },
    meta: { err: null, preBalances, postBalances,
      preTokenBalances: [row(curve, 800_000_000_000_000n)],
      postTokenBalances: [row(curve, 800_000_000_000_000n - amount - creatorKeeps), row(addresses.lock.toBase58(), escrowed), row(creator.toBase58(), creatorKeeps)] } };
  const data = Buffer.alloc(105); Buffer.from('c9e00b0c19713f1d', 'hex').copy(data); mint.toBuffer().copy(data, 8); creator.toBuffer().copy(data, 40);
  data.writeBigUInt64LE(escrowed, 72); data.writeBigInt64LE(1_800_000_000n, 80); data.writeBigInt64LE(BigInt(1_800_000_000 + lockSeconds), 88); data[104] = addresses.bump;
  const connection = { getAccountInfo: async () => ({ owner: new PublicKey(PROGRAM), data }) };
  return { connection, proof: { mint: mint.toBase58(), feePayer: creator.toBase58(), slot: 1000 }, buyTransaction: tx, buySignature: 'buy-sig',
    config: { ready: true, programId: PROGRAM, programDataSha256: 'a'.repeat(64) }, serviceQuote: { id: QUOTE }, lockSeconds };
}

test('a paired developer buy that escrows every purchased token verifies', async () => {
  const result = await verifyPairedDeveloperBuy(fixture());
  assert.equal(result.status, 'funded');
  assert.equal(result.amount, '44000000000000');
  assert.equal(result.atomicWithLaunch, false);
  assert.equal(result.atomicBuyAndEscrow, true);
});

test('the creator may not keep any purchased tokens', async () => {
  await assert.rejects(verifyPairedDeveloperBuy(fixture({ creatorKeeps: 1n })), /escrow every purchased token|equal the Pump purchase/);
});

test('only Pump, the escrow and account setup may run in the developer buy', async () => {
  await assert.rejects(verifyPairedDeveloperBuy(fixture({ extraProgram: SystemProgram.programId.toBase58() })), /only buy on Pump/);
});

test('the developer buy must follow the launch within its window', async () => {
  await assert.rejects(verifyPairedDeveloperBuy(fixture({ slot: 3000 })), /verification window/);
  await assert.rejects(verifyPairedDeveloperBuy(fixture({ slot: 900 })), /verification window/);
});

test('the escrow must hold the signed lock period', async () => {
  const f = fixture();
  await assert.rejects(verifyPairedDeveloperBuy({ ...f, lockSeconds: 86400 }), /escrow instruction|does not match/);
});

test('more than 20% of supply cannot be escrowed as a developer buy', async () => {
  await assert.rejects(verifyPairedDeveloperBuy(fixture({ amount: 200_000_000_000_001n })), /20% limit/);
});
