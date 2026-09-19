import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(input.trim())));
const programId = new PublicKey(process.env.FUNDED_ROUTER_PROGRAM_ID || 'C92L1A3ZkS9Nnau5JLAMwMUYxPSYVUTdeosHyc6WMA8W');
const [router, bump] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], programId);
const discriminator = crypto.createHash('sha256').update('global:initialize').digest().subarray(0, 8);
const instruction = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: router, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: discriminator,
});
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer], { commitment: 'confirmed' });
const account = await connection.getAccountInfo(router, 'confirmed');
if (!account) throw new Error('Router account was not found after initialization.');
console.log(JSON.stringify({ programId: programId.toBase58(), router: router.toBase58(), bump, signature, owner: account.owner.toBase58(), dataLength: account.data.length, headerHex: Buffer.from(account.data.subarray(0, 41)).toString('hex') }));
