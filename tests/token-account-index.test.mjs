import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { normalizeAllTokenAccounts } from '../server/token-accounts.mjs';

const mint = Keypair.generate().publicKey;
const wallet = Keypair.generate().publicKey;
const account = Keypair.generate().publicKey;
const data = Buffer.alloc(165);
mint.toBuffer().copy(data, 0);
wallet.toBuffer().copy(data, 32);
data.writeBigUInt64LE(120n, 64);
data[108] = 1;

test('full token account scan indexes only verified mint and program accounts', () => {
  const result = normalizeAllTokenAccounts([{ pubkey: account, account: { data, owner: TOKEN_PROGRAM_ID } }], mint, TOKEN_PROGRAM_ID);
  assert.equal(result.coverage, 'complete-account-list');
  assert.deepEqual(result.accounts, [{ address: account.toBase58(), wallet: wallet.toBase58(), amount: '120' }]);
  const wrongMint = Keypair.generate().publicKey;
  assert.throws(() => normalizeAllTokenAccounts([{ pubkey: account, account: { data, owner: TOKEN_PROGRAM_ID } }], wrongMint, TOKEN_PROGRAM_ID));
});
