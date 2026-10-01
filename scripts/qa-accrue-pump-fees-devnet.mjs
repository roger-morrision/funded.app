import bs58 from 'bs58';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { buildVerifiedPoolTradeTransaction, describeTradeQuote } from '../pump-trading.js';
import { finalizedSend } from '../server/automatic-reward-chain.mjs';

const mint = new PublicKey(process.argv[2] || 'FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH');
const side = process.argv[4] || 'buy';
if (!['buy', 'sell'].includes(side)) throw new Error('QA trade side must be buy or sell');
const amount = Number(process.argv[3] || (side === 'buy' ? '0.5' : '16000000'));
if (side === 'buy' && !(amount > 0 && amount <= 0.5)) throw new Error('QA buy limit is 0.5 Devnet SOL');
if (side === 'sell' && !(amount > 0 && amount <= 20_000_000)) throw new Error('QA sell limit is 20 million tokens');
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Devnet only');
const trader = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || ''));
if (trader.publicKey.toBase58() !== '7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk') throw new Error('Unexpected QA trader');
const pool = canonicalPumpPoolPda(mint, NATIVE_MINT);
const trade = await buildVerifiedPoolTradeTransaction({ connection, side, mint, poolAddress:pool,
  user:trader.publicKey, amount, slippagePercent:3, feeOwner:process.env.VITE_FUNDED_TRADE_FEE_OWNER });
const quote = describeTradeQuote(trade, 3);
if (side === 'buy' && quote.maximumSpendSol > 0.52) throw new Error('QA trade quote exceeds the bounded spend');
if (side === 'sell' && !(quote.minimumNetSol > 0.1)) throw new Error('QA sell quote must return more than 0.1 SOL');
const tokens = async() => (await connection.getParsedTokenAccountsByOwner(trader.publicKey, { mint }, 'finalized')).value
  .reduce((sum, row) => sum + BigInt(row.account.data.parsed.info.tokenAmount.amount), 0n);
const before = await tokens();
if (side === 'sell' && before < BigInt(Math.ceil(amount * 1_000_000))) throw new Error('QA trader has insufficient tokens for sell');
const solBefore = side === 'sell' ? await connection.getBalance(trader.publicKey, 'finalized') : null;
const signature = await finalizedSend(connection, new Transaction().add(...trade.instructions), [trader]);
const after = await tokens();
if (side === 'buy' && after <= before) throw new Error('Finalized buy did not increase QA trader token balance');
if (side === 'sell' && after >= before) throw new Error('Finalized sell did not decrease QA trader token balance');
const solAfter = side === 'sell' ? await connection.getBalance(trader.publicKey, 'finalized') : null;
if (side === 'sell' && solAfter <= solBefore) throw new Error('Finalized sell did not increase QA trader SOL balance');
console.log(JSON.stringify({ cluster:'devnet', mint:mint.toBase58(), trader:trader.publicKey.toBase58(),
  pool:pool.toBase58(), side, signature, tokenDeltaBaseUnits:String(after-before), solDeltaLamports:side === 'sell' ? solAfter-solBefore : null, quote }));
