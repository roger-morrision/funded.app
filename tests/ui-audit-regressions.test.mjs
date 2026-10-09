import { readAppSourceSync } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';

const source = readAppSourceSync();

test('in-app test wallet preserves versioned and legacy transaction types and signatures', async () => {
  const helper = source.match(/async function connectDevWallet\(\)\{[\s\S]*?\n\}/)?.[0];
  const wallet = Keypair.generate();
  const apiRequest = async (path, options) => {
    if (path === '/api/dev-wallet') return { data:{ publicKey:wallet.publicKey.toBase58() } };
    const bytes = Buffer.from(options.body.transaction, 'base64');
    const decoded = VersionedTransaction.deserialize(bytes);
    const tx = decoded.version === 'legacy' ? Transaction.from(bytes) : decoded;
    if (tx instanceof VersionedTransaction) tx.sign([wallet]);
    else tx.partialSign(wallet);
    return { data:{ transaction:Buffer.from(tx.serialize()).toString('base64') } };
  };
  const connect = new Function('apiRequest', 'sdk', `
    const DEV_MODE=true, DEV_WALLET_AUTOCONNECT=true, DEV_WALLET_ROLE='creator';
    const getProvider=()=>null, wasWalletManuallyDisconnected=()=>false, getSolana=async()=>sdk;
    const bytesToBase64=b=>Buffer.from(b).toString('base64'), base64ToBytes=b=>Buffer.from(b,'base64');
    let provider; const activateWallet=p=>{provider=p;}, setLaunchStatus=()=>{};
    ${helper}; return connectDevWallet().then(()=>provider);`);
  const provider = await connect(apiRequest, { PublicKey, Transaction, VersionedTransaction });
  const config = { payerKey:wallet.publicKey, recentBlockhash:Keypair.generate().publicKey.toBase58(),
    instructions:[SystemProgram.transfer({ fromPubkey:wallet.publicKey, toPubkey:wallet.publicKey, lamports:1 })] };
  const versioned = new VersionedTransaction(new TransactionMessage(config).compileToV0Message());
  const signed = await provider.signTransaction(versioned);
  assert.ok(signed instanceof VersionedTransaction);
  assert.deepEqual(signed.message.serialize(), versioned.message.serialize());
  assert.ok(nacl.sign.detached.verify(signed.message.serialize(), signed.signatures[0], wallet.publicKey.toBytes()));
  const legacy = new Transaction({ feePayer:wallet.publicKey, recentBlockhash:config.recentBlockhash }).add(...config.instructions);
  const signedLegacy = await provider.signTransaction(legacy);
  assert.ok(signedLegacy instanceof Transaction);
  assert.ok(signedLegacy.verifySignatures());
});

test('Explore table uses the same migrated market-cap value as token cards', () => {
  const helper = source.match(/function exploreMarketCapUsd\(record\)\{[\s\S]*?\n\}/)?.[0];
  const format = new Function('record', `const EXPLORE_CLUSTER='devnet', coinSolUsdPrice=100;
    const formatDashboardUsd=value=>'$'+value; ${helper}; return exploreMarketCapUsd(record);`);
  assert.equal(format({ migrated:true, poolMarketCapSol:27, curveCapSol:99 }), '$2700');
  assert.equal(format({ migrated:false, curveCapSol:4 }), '$400');
  assert.equal(format({ migrated:true, curveCapSol:99 }), '$—');
  const registry = readFileSync(new URL('../src/features/explore/registry-view.js', import.meta.url), 'utf8');
  assert.match(registry, /escapeHtml\(exploreMarketCapUsd\(item\)\)/);
});

test('failed balance refresh clears stale spendable SOL without affecting a new wallet session', async () => {
  const helper = source.match(/async function refreshWalletBalance\(\{ force = false \} = \{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const run = new Function('current', `
    let walletBalanceLamports=1000000000, walletBalanceRequest=0, walletBalanceFetchedAt=1;
    const captureWalletSession=()=>({provider:{publicKey:'test'}}), isWalletSessionCurrent=()=>current;
    const renderWalletBalance=()=>{}, getSolana=async()=>{}, console={warn:()=>{}};
    const connection={getBalance:async()=>{throw new Error('RPC unavailable');}};
    const withRpcRetry=fn=>fn();
    ${helper}
    return refreshWalletBalance({force:true}).then(()=>({balance:walletBalanceLamports,fetchedAt:walletBalanceFetchedAt}));
  `);
  assert.deepEqual(await run(true), { balance:null, fetchedAt:0 });
  assert.deepEqual(await run(false), { balance:1000000000, fetchedAt:1 });
});
