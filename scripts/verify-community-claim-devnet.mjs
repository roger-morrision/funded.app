import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { verifyCommunityProof } from '../community-merkle.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';

const mintValue = process.argv.find(arg => arg.startsWith('--mint='))?.slice(7);
const execute = process.argv.includes('--execute');
const role = process.argv.find(arg => arg.startsWith('--role='))?.slice(7) || 'creator';
assert(mintValue, 'Pass --mint=<fresh verified Devnet launch>.');
assert(['creator', 'referrer', 'claimant'].includes(role), 'Use a rotated Devnet QA role.');
assert.equal(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.notEqual(process.env.VITE_ALLOW_MAINNET, 'true');
const mint = new PublicKey(mintValue), program = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const wallet = Keypair.fromSecretKey(bs58.decode(process.env[`SOLANA_DEVNET_${role.toUpperCase()}_SECRET_KEY`] || ''));
const manifest = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
assert.equal(wallet.publicKey.toBase58(), manifest.find(row => row.role === role && row.cluster === 'devnet')?.address);
const connection = new Connection(process.env.SOLANA_RPC_URL, 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const evidence = await readProgramDataEvidence(connection, program);
assert(evidence.account?.executable && evidence.sha256 === process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256,
  'Devnet program bytes differ from the reviewed pinned hash.');
const api = process.env.FUNDED_PREVIEW_API_URL || 'http://127.0.0.1:8788';
const get = async path => {
  const response = await fetch(`${api}${path}`, { signal:AbortSignal.timeout(20_000) });
  const data = await response.json();
  assert(response.ok, `${path}: ${data.error || response.status}`);
  return data;
};
const reserves = await get('/api/airdrops/reserves');
const reserve = reserves.reserves?.find(row => row.mint === mint.toBase58());
assert(reserves.cluster === 'devnet' && reserve?.verified && reserve.status === 'drop-active'
  && reserve.dropOpeningSignature && reserve.totalBaseUnits && reserve.drop);
const proof = await get(`/api/airdrops/claims/proof?mint=${mint}&wallet=${wallet.publicKey}`);
assert.equal(proof.status, 'claimable');
assert.equal(proof.drop, reserve.drop);
assert.equal(proof.recipient, wallet.publicKey.toBase58());
assert(verifyCommunityProof({ drop:proof.drop, recipient:proof.recipient, amount:proof.amount,
  index:proof.index, proof:proof.proof, root:proof.root }));
const [drop] = PublicKey.findProgramAddressSync([Buffer.from('community-drop-v1'),
  new PublicKey(process.env.FUNDED_REWARD_AUTHORITY).toBuffer(), mint.toBuffer()], program);
assert.equal(drop.toBase58(), reserve.drop);
const mintInfo = await connection.getAccountInfo(mint, 'finalized');
assert(mintInfo && [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(mintInfo.owner.toBase58()));
const tokenProgram = mintInfo.owner;
const destination = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, tokenProgram);
const vault = getAssociatedTokenAddressSync(mint, drop, true, tokenProgram);
const [payment] = PublicKey.findProgramAddressSync([Buffer.from('community-pay-v1'), drop.toBuffer(), wallet.publicKey.toBuffer()], program);
const balance = async address => connection.getTokenAccountBalance(address, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
const before = await balance(destination);
const feeBufferLamports = await connection.getBalance(wallet.publicKey, 'finalized');
assert(feeBufferLamports >= 10_000_000, 'Claimant needs a bounded Devnet fee buffer.');
console.log(JSON.stringify({ stage:'preflight', cluster:'devnet', execute, mint:mint.toBase58(),
  role, wallet:wallet.publicKey.toBase58(), drop:drop.toBase58(), amountBaseUnits:proof.amount,
  index:proof.index, programHash:evidence.sha256, recipientBeforeBaseUnits:String(before) }));
if (!execute) process.exit(0);
const response = await fetch(`${api}/api/airdrops/claims/claim-instruction`, { method:'POST',
  headers:{ 'content-type':'application/json', origin:'https://funded.vip' },
  body:JSON.stringify({ mint:mint.toBase58(), wallet:wallet.publicKey.toBase58() }), signal:AbortSignal.timeout(20_000) });
const signedInstruction = await response.json();
assert(response.ok, signedInstruction.error || `HTTP ${response.status}`);
const accounts = signedInstruction.accounts;
assert.equal(signedInstruction.programId, program.toBase58());
assert.equal(signedInstruction.amount, proof.amount);
assert.equal(accounts.length, 9);
assert.deepEqual(accounts.map(row => row.pubkey), [wallet.publicKey.toBase58(), drop.toBase58(),
  wallet.publicKey.toBase58(), mint.toBase58(), vault.toBase58(), destination.toBase58(),
  payment.toBase58(), tokenProgram.toBase58(), '11111111111111111111111111111111']);
assert.equal(accounts.filter(row => row.isSigner).length, 1);
assert.equal(accounts[0].isSigner, true);
const data = Buffer.from(signedInstruction.data, 'base64');
assert(data.subarray(0, 8).equals(createHash('sha256').update('global:claim_community_drop').digest().subarray(0, 8)));
assert.equal(data.readBigUInt64LE(8), BigInt(proof.amount));
assert.equal(data.readUInt32LE(16), proof.index);
assert.equal(data.readUInt32LE(20), proof.proof.length);
assert.equal(data.length, 24 + proof.proof.length * 32);
const latest = await connection.getLatestBlockhash('finalized');
const transaction = new Transaction({ feePayer:wallet.publicKey, recentBlockhash:latest.blockhash });
if (!await connection.getAccountInfo(destination, 'finalized'))
  transaction.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, destination, wallet.publicKey, mint, tokenProgram));
transaction.add(new TransactionInstruction({ programId:program, keys:accounts.map(row => ({
  pubkey:new PublicKey(row.pubkey), isSigner:row.isSigner, isWritable:row.isWritable })), data }));
transaction.sign(wallet);
const simulation = await connection.simulateTransaction(transaction);
assert.equal(simulation.value.err, null, JSON.stringify(simulation.value.err));
const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight:false, maxRetries:2 });
const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'finalized');
assert.equal(confirmation.value.err, null);
const after = await balance(destination);
assert.equal(after - before, BigInt(proof.amount));
const paymentInfo = await connection.getAccountInfo(payment, 'finalized');
assert(paymentInfo?.owner.equals(program));
const postProof = await get(`/api/airdrops/claims/proof?mint=${mint}&wallet=${wallet.publicKey}`);
assert.equal(postProof.status, 'claimed');
console.log(JSON.stringify({ stage:'claim-finalized', cluster:'devnet', mint:mint.toBase58(), signature,
  wallet:wallet.publicKey.toBase58(), amountBaseUnits:proof.amount,
  recipientDeltaBaseUnits:String(after - before), payment:payment.toBase58(), apiStatus:postProof.status }));
process.exit(0);
