import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { buildTradeTransaction } from '../pump-trading.js';
import { finalizedSend } from '../server/automatic-reward-chain.mjs';

assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
const mint = new PublicKey(String(process.argv[2] || ''));
const apiBase = String(process.env.FUNDED_QA_API_BASE || 'http://127.0.0.1:8795').replace(/\/$/, '');
const apiToken = String(process.env.FUNDED_API_TOKEN || '').trim();
assert(apiToken, 'FUNDED_API_TOKEN is required for keeper and settlement QA.');
const trader = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY));
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const amountSol = Number(process.env.FUNDED_QA_FEE_TRADE_SOL || '0.01');
assert(amountSol > 0 && amountSol <= 0.02, 'QA fee trade must be above zero and at most 0.02 Devnet SOL.');
const tokenBalance = async () => (await connection.getParsedTokenAccountsByOwner(trader.publicKey, { mint }, 'finalized')).value
  .reduce((sum, row) => sum + BigInt(row.account.data.parsed.info.tokenAmount.amount), 0n);
const before = await tokenBalance();
const trade = await buildTradeTransaction({ connection, side:'buy', mint, user:trader.publicKey, amount:amountSol, slippagePercent:3,
  feeOwner:process.env.VITE_FUNDED_TRADE_FEE_OWNER });
const tradeSignature = await finalizedSend(connection, new Transaction().add(...trade.instructions), [trader]);
const after = await tokenBalance(); assert(after > before, 'Finalized fee-accrual trade produced no token balance increase.');
async function post(path, payload) {
  const response = await fetch(`${apiBase}${path}`, { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${apiToken}` }, body:JSON.stringify(payload), signal:AbortSignal.timeout(90_000) });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${path}: ${response.status} ${data.error || ''}`);
  return data;
}
const collection = await post('/api/keeper/collect', { mint:mint.toBase58() });
assert.equal(collection.status, 'collected'); assert.equal(collection.onchainVerified, true); assert(Number(collection.collectedLamports) > 0);
const collectionStatus = await connection.getSignatureStatus(collection.signature, { searchTransactionHistory:true });
assert.equal(collectionStatus.value?.confirmationStatus, 'finalized'); assert.equal(collectionStatus.value?.err, null);
const settlement = await post('/api/settlements/claims', { claimSignature:collection.signature });
const allocatedLamports = Math.round(Number(settlement.fundedApp?.buyback) * 1_000_000_000);
assert(allocatedLamports > 0); assert(Math.abs(allocatedLamports - Math.round(Number(collection.collectedLamports) / 100)) <= 1);
console.log(JSON.stringify({ status:'verified', cluster:'devnet', mint:mint.toBase58(), trader:trader.publicKey.toBase58(), tradeSignature,
  tokenDeltaBaseUnits:String(after-before), collectionSignature:collection.signature, collectedLamports:String(collection.collectedLamports), buybackLamports:allocatedLamports }));
