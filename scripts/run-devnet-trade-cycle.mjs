import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { createCloseAccountInstruction } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js';
import { assertTradeConfirmed, buildTradeTransaction, fetchBondingCurveSnapshot } from '../pump-trading.js';

const mint = new PublicKey(process.argv[2] || '');
assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet', 'Devnet configuration is required.');
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'confirmed');
assert.equal(await connection.getGenesisHash(), await new Connection(clusterApiUrl('devnet'), 'confirmed').getGenesisHash(), 'Configured RPC is not Devnet.');

const funder = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CLAIMANT_SECRET_KEY));
const trader = Keypair.generate();
const feeOwner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER);

async function sendTransaction(instructions, signers) {
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ recentBlockhash: latest.blockhash, feePayer: signers[0].publicKey }).add(...instructions);
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  assertTradeConfirmed(confirmation);
  return signature;
}

async function sendTrade(side, amount) {
  const prepared = await buildTradeTransaction({ connection, side, mint, user: trader.publicKey, amount, slippagePercent: 3, feeOwner });
  return sendTransaction(prepared.instructions, [trader]);
}

const snapshotBefore = await fetchBondingCurveSnapshot({ connection, mint });
const fundSignature = await sendTransaction([
  SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: trader.publicKey, lamports: 25_000_000 }),
], [funder]);
const buySignature = await sendTrade('buy', 0.003);
const accountsAfterBuy = await connection.getParsedTokenAccountsByOwner(trader.publicKey, { mint }, 'confirmed');
assert.equal(accountsAfterBuy.value.length, 1, 'Expected one token account after the buy.');
const tokenAccount = accountsAfterBuy.value[0];
const tokenProgram = tokenAccount.account.owner;
const rawTokenAmount = BigInt(tokenAccount.account.data.parsed.info.tokenAmount.amount);
const decimals = Number(tokenAccount.account.data.parsed.info.tokenAmount.decimals);
assert.ok(rawTokenAmount > 0n, 'Buy produced no token balance.');
const sellAmount = Number(rawTokenAmount) / (10 ** decimals);
const sellSignature = await sendTrade('sell', sellAmount);

const finalTokenBalance = await connection.getTokenAccountBalance(tokenAccount.pubkey, 'confirmed');
assert.equal(finalTokenBalance.value.amount, '0', 'Sell did not clear the ephemeral token balance.');
const closeSignature = await sendTransaction([
  createCloseAccountInstruction(tokenAccount.pubkey, funder.publicKey, trader.publicKey, [], tokenProgram),
], [trader]);
const refundable = await connection.getBalance(trader.publicKey, 'confirmed');
let refundSignature = null;
if (refundable > 10_000) {
  refundSignature = await sendTransaction([
    SystemProgram.transfer({ fromPubkey: trader.publicKey, toPubkey: funder.publicKey, lamports: refundable - 5_000 }),
  ], [trader]);
}
const snapshotAfter = await fetchBondingCurveSnapshot({ connection, mint });

console.log(JSON.stringify({
  cluster: 'devnet',
  mint: mint.toBase58(),
  ephemeralTrader: trader.publicKey.toBase58(),
  fundedSol: 25_000_000 / LAMPORTS_PER_SOL,
  boughtTokens: sellAmount,
  signatures: { fund: fundSignature, buy: buySignature, sell: sellSignature, close: closeSignature, refund: refundSignature },
  curve: {
    before: { complete: snapshotBefore.complete, progressPercent: snapshotBefore.progressPercent, realQuoteReservesSol: snapshotBefore.realQuoteReservesSol },
    after: { complete: snapshotAfter.complete, progressPercent: snapshotAfter.progressPercent, realQuoteReservesSol: snapshotAfter.realQuoteReservesSol },
  },
}, null, 2));
