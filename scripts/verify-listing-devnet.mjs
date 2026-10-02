import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { listingBurnBaseUnits, listingMemo } from '../listing-policy.js';

assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet'); assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
const mint = new PublicKey(String(process.argv[2] || ''));
const apiBase = String(process.env.FUNDED_QA_API_BASE || 'http://127.0.0.1:8795').replace(/\/$/, '');
const payer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CLAIMANT_SECRET_KEY));
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const [configResponse, metadataResponse] = await Promise.all([
  fetch(`${apiBase}/api/listings/config`, { signal:AbortSignal.timeout(15_000) }),
  fetch(`${apiBase}/api/listings/mint/${mint.toBase58()}`, { signal:AbortSignal.timeout(30_000) }),
]);
const config = await configResponse.json(), metadata = await metadataResponse.json();
assert.equal(configResponse.status, 200); assert.equal(config.cluster, 'devnet'); assert.equal(config.enabled, true);
assert.equal(metadataResponse.status, 200, JSON.stringify(metadata)); assert.equal(metadata.mint, mint.toBase58());
const fundedMint = new PublicKey(config.fundedMint), fundedState = await getMint(connection, fundedMint);
const amount = listingBurnBaseUnits(fundedState.decimals, config.burnTokens);
const ata = getAssociatedTokenAddressSync(fundedMint, payer.publicKey), before = await getAccount(connection, ata);
assert(before.amount >= amount, 'Claimant QA budget is insufficient for the listing burn.');
const transaction = new Transaction().add(
  createBurnCheckedInstruction(ata, fundedMint, payer.publicKey, amount, fundedState.decimals, [], TOKEN_PROGRAM_ID),
  new TransactionInstruction({ programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys:[], data:Buffer.from(listingMemo(mint.toBase58()), 'utf8') }),
);
const signature = await sendAndConfirmTransaction(connection, transaction, [payer], { commitment:'finalized', preflightCommitment:'confirmed' });
const status = await connection.getSignatureStatus(signature, { searchTransactionHistory:true }); assert.equal(status.value?.confirmationStatus, 'finalized'); assert.equal(status.value?.err, null);
const [after, mintAfter] = await Promise.all([getAccount(connection, ata), getMint(connection, fundedMint)]);
assert.equal(before.amount - after.amount, amount); assert.equal(fundedState.supply - mintAfter.supply, amount);
const payload = { mint:mint.toBase58(), wallet:payer.publicKey.toBase58(), signature };
const indexedResponse = await fetch(`${apiBase}/api/listings`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(60_000) });
const indexed = await indexedResponse.json(); assert.equal(indexedResponse.status, 201, JSON.stringify(indexed)); assert.equal(indexed.onchainVerified, true);
const replay = await fetch(`${apiBase}/api/listings`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(60_000) }); assert.equal(replay.status, 200);
console.log(JSON.stringify({ status:'verified', cluster:'devnet', mint:mint.toBase58(), wallet:payer.publicKey.toBase58(), signature, amountTokens:config.burnTokens, amountBaseUnits:String(amount), replayStatus:replay.status }));
