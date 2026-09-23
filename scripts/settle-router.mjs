import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(input.trim())));
const programId = new PublicKey(process.env.FUNDED_ROUTER_PROGRAM_ID || process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || '2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const router = new PublicKey(process.argv[2]);
const destination = new PublicKey(process.argv[3]);
const amount = BigInt(process.argv[4] || '1000000');
const claimId = crypto.createHash('sha256').update(`devnet-router-settlement:${router.toBase58()}:${destination.toBase58()}`).digest();
const [claim] = PublicKey.findProgramAddressSync([Buffer.from('claim'), claimId], programId);
const data = Buffer.alloc(8 + 32 + 4 + 8);
crypto.createHash('sha256').update('global:settle').digest().copy(data, 0, 0, 8);
claimId.copy(data, 8);
data.writeUInt32LE(1, 40);
data.writeBigUInt64LE(amount, 44);
const instruction = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: router, isSigner: false, isWritable: true },
    { pubkey: claim, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: destination, isSigner: false, isWritable: true },
  ],
  data,
});
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
const before = await connection.getBalance(destination, 'confirmed');
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [authority], { commitment: 'confirmed' });
const after = await connection.getBalance(destination, 'confirmed');
console.log(JSON.stringify({ programId: programId.toBase58(), router: router.toBase58(), claim: claim.toBase58(), destination: destination.toBase58(), amountLamports: amount.toString(), before, after, signature }));
