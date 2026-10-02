import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import bs58 from 'bs58';
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildVerifiedPoolTradeTransaction } from '../pump-trading.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';
import { resolveDevnetBuybackConfig } from './devnet-role-config.mjs';

const path = '.secrets/funded-buyback-operator-secret-key';
const lookupPath = '.secrets/funded-buyback-lookup-table-address';
const resolved = resolveDevnetBuybackConfig(process.env);
const authority = Keypair.fromSecretKey(bs58.decode(resolved.authoritySecret));
const operatorSecret = resolved.operatorSecret || (existsSync(path) ? readFileSync(path, 'utf8').trim() : '');
if (!operatorSecret) throw new Error('Dedicated Devnet buyback operator wallet has not been generated.');
const operator = Keypair.fromSecretKey(bs58.decode(operatorSecret));
if (authority.publicKey.toBase58() !== process.env.FUNDED_REWARD_AUTHORITY || operator.publicKey.equals(authority.publicKey)) throw new Error('Devnet buyback signer roles are invalid.');
const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Buyback initialization is Devnet-only.');
const program = await readProgramDataEvidence(connection, process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
if (!program.account?.executable || program.sha256 !== process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256?.toLowerCase()) throw new Error('Router program hash is not approved.');
const tokenMint = new PublicKey(process.env.FUNDED_TOKEN_MINT);
const poolAddress = process.env.FUNDED_SWAP_POOL;
const feeOwner = process.env.FUNDED_TRADE_FEE_OWNER || process.env.VITE_FUNDED_TRADE_FEE_OWNER;
const currentBalance = await connection.getBalance(operator.publicKey, 'finalized');
if (currentBalance < 10_000_000) {
  const amount = 50_000_000 - currentBalance;
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey:authority.publicKey, toPubkey:operator.publicKey, lamports:amount })), [authority], { commitment:'finalized' });
  console.log(JSON.stringify({ step:'fund-operator', signature, lamports:amount, operator:operator.publicKey.toBase58() }));
}
const ata = getAssociatedTokenAddressSync(tokenMint, operator.publicKey, false, TOKEN_PROGRAM_ID);
if (!(await connection.getAccountInfo(ata, 'finalized'))) {
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, operator.publicKey, tokenMint)), [authority], { commitment:'finalized' });
  console.log(JSON.stringify({ step:'create-operator-ata', signature, tokenAccount:ata.toBase58() }));
}
const trade = await buildVerifiedPoolTradeTransaction({ connection, side:'buy', mint:tokenMint, user:operator.publicKey, amount:0.000001, slippagePercent:1, feeOwner, feeBps:Number(process.env.FUNDED_TRADE_FEE_BPS || 50), poolAddress });
const keys = new Map();
for (const instruction of trade.instructions) {
  keys.set(instruction.programId.toBase58(), instruction.programId);
  for (const entry of instruction.keys) if (!entry.isSigner) keys.set(entry.pubkey.toBase58(), entry.pubkey);
}
const addresses = [...keys.values()];
const qaLookupPath = `.secrets/funded-buyback-lookup-table-${authority.publicKey.toBase58()}.address`;
let tableAddress = null, table = null;
for (const candidate of [qaLookupPath, lookupPath]) {
  if (!existsSync(candidate)) continue;
  const address = new PublicKey(readFileSync(candidate, 'utf8').trim());
  const result = await connection.getAddressLookupTable(address, { commitment:'finalized' });
  if (result.value?.state.authority?.equals(authority.publicKey)) { tableAddress = address; table = result.value; break; }
}
if (tableAddress && table) {
  const missing = addresses.filter(address => !table.state.addresses.some(existing => existing.equals(address)));
  for (let index = 0; index < missing.length; index += 20) {
    const extend = AddressLookupTableProgram.extendLookupTable({ payer:authority.publicKey, authority:authority.publicKey, lookupTable:tableAddress, addresses:missing.slice(index,index+20) });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(extend), [authority], { commitment:'finalized' });
    console.log(JSON.stringify({ step:'extend-existing-lookup-table', signature, from:index, count:Math.min(20,missing.length-index) }));
  }
} else {
  const slot = await connection.getSlot('finalized');
  const [create, address] = AddressLookupTableProgram.createLookupTable({ authority:authority.publicKey, payer:authority.publicKey, recentSlot:slot });
  const created = await sendAndConfirmTransaction(connection, new Transaction().add(create), [authority], { commitment:'finalized' });
  tableAddress = address;
  writeFileSync(qaLookupPath, address.toBase58(), { flag:'wx', mode:0o600 });
  console.log(JSON.stringify({ step:'create-lookup-table', signature:created, lookupTable:address.toBase58() }));
  for (let index = 0; index < addresses.length; index += 20) {
    const extend = AddressLookupTableProgram.extendLookupTable({ payer:authority.publicKey, authority:authority.publicKey, lookupTable:address, addresses:addresses.slice(index,index+20) });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(extend), [authority], { commitment:'finalized' });
    console.log(JSON.stringify({ step:'extend-lookup-table', signature, from:index, count:Math.min(20,addresses.length-index) }));
  }
}
console.log(JSON.stringify({ step:'ready', operator:operator.publicKey.toBase58(), lookupTable:tableAddress.toBase58(), addresses:addresses.length }));
