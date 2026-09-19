import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(input.trim())));
const programId = new PublicKey(process.env.FUNDED_ROUTER_PROGRAM_ID || 'C92L1A3ZkS9Nnau5JLAMwMUYxPSYVUTdeosHyc6WMA8W');
const [router, bump] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], programId);
const discriminator = crypto.createHash('sha256').update('global:repair_header').digest().subarray(0, 8);
const instruction = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    { pubkey: router, isSigner: false, isWritable: true },
  ],
  data: discriminator,
});
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [authority], { commitment: 'confirmed' });
const account = await connection.getAccountInfo(router, 'confirmed');
if (!account) throw new Error('Router account was not found after repair.');
console.log(JSON.stringify({ programId: programId.toBase58(), router: router.toBase58(), bump, signature, owner: account.owner.toBase58(), dataLength: account.data.length, headerHex: Buffer.from(account.data.subarray(0, 41)).toString('hex') }));
