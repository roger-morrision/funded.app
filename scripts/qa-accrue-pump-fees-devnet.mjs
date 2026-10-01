import bs58 from 'bs58';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { buildVerifiedPoolTradeTransaction, describeTradeQuote } from '../pump-trading.js';
import { finalizedSend } from '../server/automatic-reward-chain.mjs';

const mint = new PublicKey(process.argv[2] || 'FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH');
const amountSol = Number(process.argv[3] || '0.5');
if (!(amountSol > 0 && amountSol <= 0.5)) throw new Error('QA trade limit is 0.5 Devnet SOL');
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Devnet only');
const trader = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || ''));
if (trader.publicKey.toBase58() !== '7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk') throw new Error('Unexpected QA trader');
const pool = canonicalPumpPoolPda(mint, NATIVE_MINT);
const trade = await buildVerifiedPoolTradeTransaction({ connection, side:'buy', mint, poolAddress:pool,
  user:trader.publicKey, amount:amountSol, slippagePercent:3, feeOwner:process.env.VITE_FUNDED_TRADE_FEE_OWNER });
const quote = describeTradeQuote(trade, 3);
if (quote.maximumSpendSol > 0.52) throw new Error('QA trade quote exceeds the bounded spend');
const tokens = async() => (await connection.getParsedTokenAccountsByOwner(trader.publicKey, { mint }, 'finalized')).value
  .reduce((sum, row) => sum + BigInt(row.account.data.parsed.info.tokenAmount.amount), 0n);
const before = await tokens();
const signature = await finalizedSend(connection, new Transaction().add(...trade.instructions), [trader]);
const after = await tokens();
if (after <= before) throw new Error('Finalized buy did not increase QA trader token balance');
console.log(JSON.stringify({ cluster:'devnet', mint:mint.toBase58(), trader:trader.publicKey.toBase58(),
  pool:pool.toBase58(), signature, boughtBaseUnits:String(after-before), quote }));
