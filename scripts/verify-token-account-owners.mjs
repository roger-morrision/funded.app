import assert from 'node:assert/strict';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { attachVerifiedTokenAccountWallets } from '../server/token-accounts.mjs';

const mint = new PublicKey(Buffer.alloc(32, 1));
const wallet = new PublicKey(Buffer.alloc(32, 2));
const account = new PublicKey(Buffer.alloc(32, 3));
const data = Buffer.alloc(165);
mint.toBuffer().copy(data, 0);
wallet.toBuffer().copy(data, 32);
data.writeBigUInt64LE(228_123_548_210_887n, 64);
data[108] = 1;

const sample = { accounts: [{ address: account.toBase58(), amount: '228123548210887' }] };
const info = { owner: TOKEN_2022_PROGRAM_ID, data };
assert.equal(attachVerifiedTokenAccountWallets(sample, [info], mint).accounts[0].wallet, wallet.toBase58());
assert.equal(attachVerifiedTokenAccountWallets(sample, [info], account).accounts[0].wallet, null, 'Wrong mint must not attribute a wallet.');
assert.equal(attachVerifiedTokenAccountWallets(sample, [{ ...info, owner: SystemProgram.programId }], mint).accounts[0].wallet, null, 'Non-token programs must not attribute a wallet.');
assert.equal(attachVerifiedTokenAccountWallets(sample, [{ ...info, data: data.subarray(0, 100) }], mint).accounts[0].wallet, null, 'Truncated accounts must not attribute a wallet.');
assert.equal(attachVerifiedTokenAccountWallets(sample, [], mint).accounts[0].wallet, null, 'Missing account data must remain unclassified.');

console.log('Verified token-account wallet attribution checks passed.');
