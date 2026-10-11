import crypto from 'node:crypto';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

const encoded = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim();
let payer;
if (encoded) payer = Keypair.fromSecretKey(bs58.decode(encoded));
else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(input.trim())));
}
const programId = new PublicKey(process.env.FUNDED_ROUTER_PROGRAM_ID || process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || '61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa');
const appOwnerSecret = String(process.env.FUNDED_APP_OWNER_SECRET_KEY || '').trim();
if (!appOwnerSecret) throw new Error('The program upgrade owner signer is required to initialize the router.');
const appOwner = Keypair.fromSecretKey(bs58.decode(appOwnerSecret));
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Refusing to initialize router outside Solana Devnet.');
const programAccount = await connection.getAccountInfo(programId, 'confirmed');
if (!programAccount?.executable || programAccount.data.length < 36 || programAccount.data.readUInt32LE(0) !== 2) throw new Error('Expected an executable upgradeable router program.');
const programData = new PublicKey(programAccount.data.subarray(4, 36));
const [router, bump] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], programId);
const discriminator = crypto.createHash('sha256').update('global:initialize').digest().subarray(0, 8);
const instruction = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: appOwner.publicKey, isSigner: true, isWritable: false },
    { pubkey: router, isSigner: false, isWritable: true },
    { pubkey: programId, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: discriminator,
});
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer, appOwner], { commitment: 'confirmed' });
const account = await connection.getAccountInfo(router, 'confirmed');
if (!account) throw new Error('Router account was not found after initialization.');
console.log(JSON.stringify({ programId: programId.toBase58(), router: router.toBase58(), bump, signature, owner: account.owner.toBase58(), dataLength: account.data.length, headerHex: Buffer.from(account.data.subarray(0, 41)).toString('hex') }));
