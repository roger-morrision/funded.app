import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

const mode = process.argv[2];
assert(['fund', 'repay'].includes(mode), 'Use fund or repay.');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL, 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const wallet = name => Keypair.fromSecretKey(bs58.decode(process.env[name] || ''));
const payer = wallet('SOLANA_DEVNET_CREATOR_SECRET_KEY');
assert.equal(payer.publicKey.toBase58(), '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
const sources = [
  ['SOLANA_DEVNET_REFERRER_SECRET_KEY', '7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk', 850_000_000],
  ['SOLANA_DEVNET_CLAIMANT_SECRET_KEY', 'Gv3uSJu2Ki7eqC6V4H1Fc31MMXLih6TJR19a5sydPfr7', 480_000_000],
  ['QA_DEVNET_TRADING_FEE_TREASURY_SECRET_KEY', 'CmhmRtKYExJC76R5nsPV9ovPYacoEQFEL7VhaKRZmLy2', 120_000_000],
  ['SOLANA_DEVNET_REFERRER_LEVEL_2_SECRET_KEY', '9wFEV3bLscLqvXVYwXMyF5CaniccndLi4fGivSCuYs3R', 50_000_000],
  ['SOLANA_DEVNET_REFERRER_LEVEL_3_SECRET_KEY', '4yRRW1ikd1JaSzZFCngnx2ChuUHu1FRdRCTS6m5NN42v', 50_000_000],
];
let transferred = 0;
for (const [name, expected, amount] of sources) {
  const source = wallet(name);
  assert.equal(source.publicKey.toBase58(), expected);
  const from = mode === 'fund' ? source : payer;
  const to = mode === 'fund' ? payer.publicKey : source.publicKey;
  const beforeFrom = await connection.getBalance(from.publicKey, 'finalized');
  const beforeTo = await connection.getBalance(to, 'finalized');
  assert(beforeFrom >= amount + 20_000_000, `Insufficient QA reserve for ${name}`);
  const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey:from.publicKey, toPubkey:to, lamports:amount }));
  const signature = await sendAndConfirmTransaction(connection, transaction, [from], { commitment:'finalized' });
  const afterTo = await connection.getBalance(to, 'finalized');
  assert.equal(afterTo - beforeTo, amount, 'Finalized recipient balance delta differs.');
  transferred += amount;
  console.log(JSON.stringify({ mode, from:from.publicKey.toBase58(), to:to.toBase58(), amountLamports:amount, signature }));
}
console.log(JSON.stringify({ mode, totalLamports:transferred, payerBalanceLamports:await connection.getBalance(payer.publicKey, 'finalized') }));
