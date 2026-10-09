import { readAppSource } from './read-app-source.mjs';
import { readStylesheet } from './read-stylesheet.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canSignTransactions, connectWalletProvider, selectRememberedWalletProvider, selectWalletProvider, walletAddress, walletLaunches } from '../wallet-core.js';
import { submitTrade } from '../pump-trading.js';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
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
  preparedTrade: { side: 'buy', mint: user, user, inputAmount: 1, slippagePercent: 1, outputAmount: new BN(1), instructions: [instruction] },
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
  preparedTrade: { side: 'buy', mint: user, user, inputAmount: 1, slippagePercent: 1, outputAmount: new BN(1), instructions: [instruction] },
  assertWalletCurrent: () => { if (!current) throw new Error('wallet changed'); },
}), /wallet changed/);
assert.equal(signed, true);
assert.equal(sent, false);

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = (await Promise.all(['../app.js', '../src/features/portfolio/wallet-detail-view.js']
  .map(path => path === '../app.js' ? readAppSource() : readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
const coinDetailCss = await readStylesheet(new URL('../coin-detail.css', import.meta.url));
const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const previewCompose = await readFile(new URL('../compose.preview.yml', import.meta.url), 'utf8');
assert.match(html, /aria-selected="true" tabindex="0" data-wallet-tab="activity"/);
assert.match(html, /aria-selected="false" tabindex="-1" data-wallet-tab="balances"/);
assert.match(app, /button\.tabIndex = active \? 0 : -1/);
assert.match(app, /if \(address && address === connectedWalletAddress\) void loadFundedBurnState\(\)/, 'The connected wallet page must load its live $FUNDED balance.');
assert.match(app, /const exploreInitialLoadStarted = !coinRouteRequested\(\);\s*if \(exploreInitialLoadStarted\) loadOnchainExploreData\(\)\.catch/, 'Direct wallet routes must load verified trade activity before reporting wallet trade counts.');
assert.doesNotMatch(app, /!coinRouteRequested\(\) && !walletRouteRequested\(\) && exploreAutoRefresh/, 'Wallet activity must remain eligible for verified market refresh.');
assert.doesNotMatch(app, /asset\.creator === address && asset\.address && !combined\.has\(asset\.address\)/, 'Wallet launch counts must not promote unregistered market assets to verified funded launches.');
assert.match(app, /fundedBurnState\.wallet === address && fundedBurnState\.status === 'ready'[\s\S]*?formatTokenBaseUnits\(fundedBurnState\.balanceBaseUnits, fundedBurnState\.decimals, 6\)/, 'The wallet balance tab must use the verified Devnet $FUNDED balance.');
assert.match(app, /function renderWalletFundedBalance\(\)[\s\S]*?fundedBurnState\.wallet === connectedWalletAddress[\s\S]*?fundedBurnState\.status === 'ready'[\s\S]*?formatTokenBaseUnits\(fundedBurnState\.balanceBaseUnits, fundedBurnState\.decimals, 6\)/, 'The wallet menu must use the verified balance for the currently connected wallet.');
assert.match(app, /fundedBurnState = \{\s*status: 'ready'[\s\S]*?renderWalletFundedBalance\(\)/, 'The wallet menu must refresh after its live Devnet balance loads.');
assert.match(html, /id="wallet-popover-funded">—<\/strong><small>\$FUNDED<\/small><\/span><em>Balance unavailable<\/em>/, 'The disconnected wallet menu must not claim its balance is merely unindexed.');
assert.match(coinDetailCss, /\.wallet-detail-actions>a\[hidden\]\{display:none\}/, 'Hidden wallet actions must not be shown by the flex link style.');
assert.match(html, /id="profile-copy-address"[^>]+disabled/, 'The initial disconnected profile must not expose a usable copy-address action.');
assert.match(html, /id="profile-disconnect" disabled/, 'The initial disconnected profile must not expose a usable disconnect action.');
assert.match(app, /profileCopyAddress\.disabled = !connected/, 'Wallet state must enable copy-address only after connection.');
assert.match(app, /profileDisconnect\.disabled = !connected/, 'Wallet state must enable disconnect only after connection.');
assert.match(app, /if \(!tradeInputs\(\)\.valid \|\| !wallet \|\| !canSignTransactions\(wallet\)[^\n]*\) return;/, 'Automatic trade quotes must require valid inputs and a signing wallet.');
assert.match(app, /Connect a signing wallet to calculate an exact trade quote/, 'Trade quote must explain its wallet prerequisite.');
assert.match(app, /button\.textContent = fundedBuyBusy \? 'Waiting for Solana…' : fundedBuyPreview \? 'Confirm buy' : wallet \? 'Preview buy' : 'Connect wallet to preview'/, '$FUNDED buy preview must describe its wallet prerequisite before opening a connection flow.');
assert.match(dockerfile, /ARG VITE_DEV_WALLET_ROLE=creator/, 'The image build must accept the selected disposable Devnet wallet role.');
assert.match(previewCompose, /VITE_DEV_MODE: "false"/, 'The default preview must not expose a disposable signing wallet.');
assert.match(previewCompose, /VITE_DEV_AUTOCONNECT: "false"/, 'The default preview must require deliberate wallet connection.');
assert.match(previewCompose, /SOLANA_DEVNET_CREATOR_SECRET_KEY_FILE: \/run\/secrets\/solana_devnet_creator_secret_key/, 'The local preview must read its server-side disposable creator wallet from a secret file.');
assert.match(previewCompose, /SOLANA_KEEPER_CONFIGURED: "true"/, 'The Devnet preview must explicitly opt in before its disposable keeper can execute verified referral payouts.');
assert.match(previewCompose, /SOLANA_KEEPER_SECRET_KEY_FILE: \/run\/secrets\/solana_keeper_secret_key/, 'The Devnet preview keeper must use a configured disposable test wallet secret file.');
assert.match(previewCompose, /AUTOMATIC_REWARD_STORE_PATH: \/app\/data\/automatic-rewards\/ledger\.json/, 'The preview and automatic reward worker must read the same durable ledger.');
assert.match(previewCompose, /funded_reward_ledger:\/app\/data\/automatic-rewards/, 'The preview must mount the automatic reward ledger.');

console.log('wallet state checks passed');
