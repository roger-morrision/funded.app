import assert from 'node:assert/strict';
import bs58 from 'bs58';
import BN from 'bn.js';
import { OnlinePumpAmmSdk, PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

// A small, bounded Devnet-only market for the existing protocol mint. A dry run
// is the default; creating the pool requires an explicit environment flag.
assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET || 'false', 'false');
const mint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const signer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY));
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL, 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const baseIn = new BN('100000000000'); // 100,000 $FUNDED at six decimals.
const quoteIn = new BN('100000000'); // 0.1 Devnet SOL.
const state = await new OnlinePumpAmmSdk(connection).createPoolSolanaState(1, signer.publicKey, mint, NATIVE_MINT);
if (await connection.getAccountInfo(state.poolKey, 'finalized')) {
  console.log(JSON.stringify({ status:'already-exists', pool:state.poolKey.toBase58(), cluster:'devnet' }));
  process.exit(0);
}
const balance = await connection.getBalance(signer.publicKey, 'finalized');
const source = await connection.getTokenAccountBalance(state.userBaseTokenAccount, 'finalized');
assert.ok(balance > Number(quoteIn.toString()) + 50_000_000, 'Issuer lacks the bounded SOL budget and account reserve.');
assert.ok(BigInt(source.value.amount) >= BigInt(baseIn.toString()), 'Issuer lacks the bounded $FUNDED liquidity.');
const instructions = await PUMP_AMM_SDK.createPoolInstructions(state, baseIn, quoteIn);
const block = await connection.getLatestBlockhash('finalized');
const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash:block.blockhash }).add(...instructions);
transaction.sign(signer);
assert.ok(transaction.serialize().length <= 1232, 'Pool transaction exceeds the Solana packet limit.');
const simulation = await connection.simulateTransaction(transaction, [signer]);
if (simulation.value.err) throw new Error(`Pool simulation failed: ${JSON.stringify(simulation.value.err)}; ${simulation.value.logs?.slice(-6).join(' | ')}`);
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ status:'simulated', pool:state.poolKey.toBase58(), issuer:signer.publicKey.toBase58(), baseIn:baseIn.toString(), quoteIn:quoteIn.toString(), fee:simulation.value.unitsConsumed, cluster:'devnet' }));
  process.exit(0);
}
const signature = await sendAndConfirmTransaction(connection, transaction, [signer], { commitment:'finalized', preflightCommitment:'confirmed' });
const account = await connection.getAccountInfo(state.poolKey, 'finalized');
if (!account) throw new Error('Pool transaction finalized without a pool account.');
const [base, quote] = await Promise.all([
  connection.getTokenAccountBalance(state.poolBaseTokenAccount, 'finalized'),
  connection.getTokenAccountBalance(state.poolQuoteTokenAccount, 'finalized'),
]);
const sourceAfter = await connection.getTokenAccountBalance(state.userBaseTokenAccount, 'finalized');
if (BigInt(base.value.amount) !== BigInt(baseIn.toString()) || BigInt(quote.value.amount) !== BigInt(quoteIn.toString()) || BigInt(source.value.amount) - BigInt(sourceAfter.value.amount) !== BigInt(baseIn.toString())) throw new Error('Pool and issuer balances do not reflect the exact initial liquidity deltas.');
console.log(JSON.stringify({ status:'created', pool:state.poolKey.toBase58(), signature, baseAmount:base.value.amount, quoteAmount:quote.value.amount, cluster:'devnet' }));
