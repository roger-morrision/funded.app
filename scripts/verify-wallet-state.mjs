import assert from 'node:assert/strict';
import { canSignTransactions, connectWalletProvider, selectRememberedWalletProvider, selectWalletProvider, walletAddress, walletLaunches } from '../wallet-core.js';
import { submitTrade } from '../pump-trading.js';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { isAppPagePath } from '../server/page-routes.mjs';

const keyA = { toBase58: () => 'account-a' };
const keyB = { toBase58: () => 'account-b' };
const disconnected = { isConnected: false, publicKey: null, connect: async () => {}, signTransaction: async () => {} };
const connected = { isConnected: true, publicKey: keyA, connect: async () => ({ publicKey: keyA }), signTransaction: async () => {} };
assert.equal(selectWalletProvider([disconnected, connected, connected]), connected);
assert.equal(selectWalletProvider([disconnected]), disconnected);
assert.equal(selectRememberedWalletProvider([{ id: 'phantom', provider: connected }, { id: 'backpack', provider: disconnected }], 'backpack'), disconnected);
assert.equal(selectRememberedWalletProvider([{ id: 'phantom', provider: connected }, { id: 'backpack', provider: disconnected }], 'missing'), connected);
assert.equal(walletAddress(connected), 'account-a');
assert.equal(canSignTransactions({ ...connected, readOnly: true }), false);
assert.equal(canSignTransactions({ ...connected, isConnected: false }), false);
assert.equal((await connectWalletProvider(connected)).provider, connected);
await assert.rejects(connectWalletProvider({ ...connected, connect: async () => ({ publicKey: keyB }) }), /account changed/);
await assert.rejects(connectWalletProvider({ ...connected, publicKey: null }), /cannot sign/);
let trustedOption;
await connectWalletProvider({ ...connected, connect: async options => { trustedOption = options; return { publicKey: keyA }; } }, { onlyIfTrusted: true });
assert.deepEqual(trustedOption, { onlyIfTrusted: true });
const launches = [
  { creatorWallet: 'account-a', mint: 'valid-mint-a' },
  { creatorWallet: 'account-b', mint: 'valid-mint-b' },
  { creatorWallet: 'account-a', mint: null },
];
assert.deepEqual(walletLaunches(launches, 'account-a'), [launches[0]]);
assert.deepEqual(walletLaunches(launches, 'account-b'), [launches[1]]);
assert.deepEqual(walletLaunches(launches, null), []);
assert.equal(isAppPagePath('/'), true);
assert.equal(isAppPagePath('/explore'), true);
assert.equal(isAppPagePath('/token/11111111111111111111111111111111'), true);
assert.equal(isAppPagePath('/launch/coin/11111111111111111111111111111111'), true);
assert.equal(isAppPagePath('/assets/missing.js'), false);
assert.equal(isAppPagePath('/api/health'), false);
assert.equal(isAppPagePath('/token/invalid'), false);

const user = new PublicKey('11111111111111111111111111111111');
const instruction = SystemProgram.transfer({ fromPubkey: user, toPubkey: user, lamports: 1 });
let signed = false;
let sent = false;
let current = true;
await assert.rejects(submitTrade({
  connection: { getLatestBlockhash: async () => { current = false; return { blockhash: user.toBase58(), lastValidBlockHeight: 1 }; }, sendRawTransaction: async () => { sent = true; return 'signature'; } },
  provider: { signTransaction: async () => { signed = true; return { serialize: () => Buffer.from([1]) }; } },
  side: 'buy', mint: user, user, amount: 1, slippagePercent: 1,
  preparedTrade: { side: 'buy', mint: user, user, inputAmount: 1, slippagePercent: 1, instructions: [instruction] },
  assertWalletCurrent: () => { if (!current) throw new Error('wallet changed'); },
}), /wallet changed/);
assert.equal(signed, false);
assert.equal(sent, false);

current = true;
signed = false;
sent = false;
await assert.rejects(submitTrade({
  connection: { getLatestBlockhash: async () => ({ blockhash: user.toBase58(), lastValidBlockHeight: 1 }), sendRawTransaction: async () => { sent = true; return 'signature'; } },
  provider: { signTransaction: async () => { signed = true; current = false; return { serialize: () => Buffer.from([1]) }; } },
  side: 'buy', mint: user, user, amount: 1, slippagePercent: 1,
  preparedTrade: { side: 'buy', mint: user, user, inputAmount: 1, slippagePercent: 1, instructions: [instruction] },
  assertWalletCurrent: () => { if (!current) throw new Error('wallet changed'); },
}), /wallet changed/);
assert.equal(signed, true);
assert.equal(sent, false);

console.log('wallet state checks passed');
