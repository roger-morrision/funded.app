import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { tokenDiscriminators, deriveTokenAccountsV3, buildTokenSettlementInstruction, buildTokenDisbursementInstruction,
  buildTokenAccountSetupInstructions, decodeTokenLedgerV3 } from '../mint-router-v3-token.js';

const anchor = name => createHash('sha256').update(name).digest().subarray(0, 8).toString('hex');

test('token instruction and account discriminators match Anchor', () => {
  for (const name of ['initialize_token_ledger_v3', 'settle_mint_token_v3', 'approve_protected_token_withdrawal_v3', 'disburse_protected_mint_token_v3'])
    assert.equal(tokenDiscriminators[name], anchor(`global:${name}`), name);
  assert.equal(tokenDiscriminators.MintTokenLedgerV3, anchor('account:MintTokenLedgerV3'));
});

test('settlement passes the router token account and seven vault token accounts', () => {
  const programId = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, quote = Keypair.generate().publicKey;
  const accounts = deriveTokenAccountsV3(programId, mint, quote, TOKEN_PROGRAM_ID);
  const ix = buildTokenSettlementInstruction({ programId, mint, quoteMint: quote, tokenProgram: TOKEN_PROGRAM_ID,
    authority: Keypair.generate().publicKey, claimId: new Uint8Array(32).fill(7), amount: 1234n });
  assert.equal(ix.keys.length, 11 + 7);
  assert.ok(ix.keys[7].pubkey.equals(accounts.routerToken) && ix.keys[7].isWritable);
  assert.deepEqual(ix.keys.slice(11).map(row => row.pubkey.toBase58()), accounts.vaultTokens.map(account => account.toBase58()));
  assert.equal(ix.data.length, 8 + 32 + 8);
  assert.equal(ix.data.readBigUInt64LE(40), 1234n);
  assert.equal(buildTokenAccountSetupInstructions({ programId, mint, quoteMint: quote, tokenProgram: TOKEN_PROGRAM_ID, payer: Keypair.generate().publicKey }).length, 8);
  const pay = buildTokenDisbursementInstruction({ programId, mint, quoteMint: quote, tokenProgram: TOKEN_PROGRAM_ID, authority: Keypair.generate().publicKey,
    creator: Keypair.generate().publicKey, recipientOwner: Keypair.generate().publicKey, withdrawalId: new Uint8Array(32), category: 2, beneficiary: 4, amount: 5n });
  assert.ok(pay.keys[8].pubkey.equals(accounts.vaultTokens[2]));
  assert.equal(pay.data.length, 8 + 32 + 2 + 16);
});

test('token ledger decodes', () => {
  const data = Buffer.alloc(8 + 32 + 32 + 8 + 56 + 56 + 24 + 1);
  Buffer.from(tokenDiscriminators.MintTokenLedgerV3, 'hex').copy(data);
  const mint = Keypair.generate().publicKey; mint.toBuffer().copy(data, 8);
  data.writeBigUInt64LE(99n, 72); data.writeBigUInt64LE(5n, 80);
  const ledger = decodeTokenLedgerV3(data);
  assert.equal(ledger.mint, mint.toBase58());
  assert.equal(ledger.settled, 99n);
  assert.equal(ledger.paid[0], 5n);
  assert.throws(() => decodeTokenLedgerV3(Buffer.alloc(10)));
  assert.ok(new PublicKey(ledger.quoteMint));
});
