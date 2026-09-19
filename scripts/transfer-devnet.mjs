import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const secret = (await new Promise((resolve) => {
  let value = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { value += chunk; });
  process.stdin.on('end', () => resolve(value.trim()));
}));
if (!secret) throw new Error('Expected base58 secret on stdin.');
const payer = Keypair.fromSecretKey(bs58.decode(secret));
const destination = new PublicKey(process.argv[2]);
const lamports = Math.round(Number(process.argv[3]) * 1_000_000_000);
if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error('Amount must be a positive SOL number.');
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: destination, lamports })), [payer], { commitment: 'confirmed' });
console.log(JSON.stringify({ from: payer.publicKey.toBase58(), to: destination.toBase58(), sol: lamports / 1_000_000_000, signature }));
