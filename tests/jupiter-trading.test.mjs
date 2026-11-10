import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token';
import { buildJupiterTrade, JUPITER_PROGRAM_ID } from '../jupiter-trading.js';

const user = Keypair.generate().publicKey, mint = Keypair.generate().publicKey.toBase58(), fee = Keypair.generate().publicKey.toBase58();
const ix = (programId, accounts = [], data = Buffer.alloc(8)) => ({ programId, accounts, data: Buffer.from(data).toString('base64') });
const transferData = lamports => { const b = Buffer.alloc(12); b.writeUInt32LE(2, 0); b.writeBigUInt64LE(BigInt(lamports), 4); return b; };
const response = (side, extra = {}) => ({ available: true, data: { side, mint, user: user.toBase58(), decimals: 6, amount: side === 'buy' ? '100000000' : '5000000',
  quote: { inAmount: side === 'buy' ? '100000000' : '5000000', outAmount: '2000000', otherAmountThreshold: '1980000', priceImpactPct: '0.001', routes: ['Pump.fun'] },
  instructions: { computeBudgetInstructions: [ix('ComputeBudget111111111111111111111111111111')], setupInstructions: [], swapInstruction: ix(JUPITER_PROGRAM_ID, [{ pubkey: user.toBase58(), isSigner: true, isWritable: true }]),
    cleanupInstruction: null, otherInstructions: [], ...extra }, lookupTables: [], blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 10 } });

test('Jupiter buy appends exactly 1% of the SOL input to the fee wallet', async () => {
  const trade = await buildJupiterTrade({ side: 'buy', mint, user, amount: '0.1', feeOwner: fee, feeBps: 100, request: async () => response('buy') });
  const last = trade.jupiter.instructions.at(-1);
  assert.equal(last.programId.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(last.keys[1].pubkey.toBase58(), fee);
  assert.equal(trade.feeLamports, 1_000_000);
});
test('Jupiter sell fee uses the minimum SOL output', async () => {
  const trade = await buildJupiterTrade({ side: 'sell', mint, user, amount: '5', feeOwner: fee, feeBps: 100, request: async () => response('sell') });
  assert.equal(trade.feeLamports, 19_800);
});
test('unexpected programs, signers and SOL transfers are refused', async () => {
  const other = Keypair.generate().publicKey.toBase58();
  await assert.rejects(buildJupiterTrade({ side: 'buy', mint, user, amount: '0.1', feeOwner: fee, request: async () => response('buy', { otherInstructions: [ix(other)] }) }), /unexpected program/);
  await assert.rejects(buildJupiterTrade({ side: 'buy', mint, user, amount: '0.1', feeOwner: fee, request: async () => response('buy', { setupInstructions: [ix(SystemProgram.programId.toBase58(),
    [{ pubkey: user.toBase58(), isSigner: true, isWritable: true }, { pubkey: other, isSigner: false, isWritable: true }], transferData(5))] }) }), /unexpected account/);
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, user, true).toBase58();
  const ok = await buildJupiterTrade({ side: 'buy', mint, user, amount: '0.1', feeOwner: fee, request: async () => response('buy', { setupInstructions: [ix(SystemProgram.programId.toBase58(),
    [{ pubkey: user.toBase58(), isSigner: true, isWritable: true }, { pubkey: wsol, isSigner: false, isWritable: true }], transferData(5))] }) });
  assert.ok(ok);
  await assert.rejects(buildJupiterTrade({ side: 'buy', mint, user, amount: '0.1', feeOwner: fee, request: async () => response('buy', { otherInstructions: [ix(JUPITER_PROGRAM_ID, [{ pubkey: other, isSigner: true, isWritable: false }])] }) }), /another signer/);
});
test('a quote that does not match the requested amount is refused', async () => {
  const bad = response('buy'); bad.data.quote.inAmount = '1';
  await assert.rejects(buildJupiterTrade({ side: 'buy', mint, user, amount: '0.1', feeOwner: fee, request: async () => bad }), /did not match/);
});
