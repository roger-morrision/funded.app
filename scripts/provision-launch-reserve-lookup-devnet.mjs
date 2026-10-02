import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { OnlinePumpSdk, PUMP_SDK, getBuySolAmountFromTokenAmount } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { buildMintRouterInitializeInstruction } from '../mint-router-launch.js';
import { rewardAddresses, DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

// Only stable keys belong in this table. Mint, curve, vault and wallet keys are
// generated per launch and must stay in the transaction's static account list.
async function launchKeys({ global, payer, programId, authority }) {
  const mint = Keypair.generate().publicKey;
  const router = buildMintRouterInitializeInstruction({ programId, mint, payer }).router.address;
  const amount = 30_000_000n * 1_000_000n;
  const quote = getBuySolAmountFromTokenAmount({ global, feeConfig:null, mintSupply:null, bondingCurve:null, amount:new BN(amount.toString()), quoteMint:NATIVE_MINT });
  const instructions = await PUMP_SDK.createV2AndBuyInstructions({ global, mint, name:'Reserve lookup', symbol:'RLOOK', uri:`https://funded.vip/devnet-metadata/${mint.toBase58()}`, creator:router, user:payer, amount:new BN(amount.toString()), solAmount:quote, mayhemMode:false, cashback:false, holderReward:false });
  const { vault } = rewardAddresses({ programId, authority, mint });
  const source = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_2022_PROGRAM_ID);
  const destination = getAssociatedTokenAddressSync(mint, vault, true, TOKEN_2022_PROGRAM_ID);
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(payer, destination, vault, mint, TOKEN_2022_PROGRAM_ID));
  instructions.push(createTransferCheckedInstruction(source, mint, destination, payer, amount, 6, [], TOKEN_2022_PROGRAM_ID));
  return new Set(instructions.flatMap(ix => [ix.programId, ...ix.keys.map(row => row.pubkey)]).map(key => key.toBase58()));
}

assert.equal(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET || 'false', 'false');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const secret = process.env.QA_DEVNET_ROUTER_AUTHORITY_SECRET_KEY;
assert.ok(secret, 'The current disposable Devnet router authority signer is required.');
const signer = Keypair.fromSecretKey(bs58.decode(secret));
const authority = new PublicKey(process.env.FUNDED_REWARD_AUTHORITY);
assert.ok(signer.publicKey.equals(authority), 'Router authority does not match the deployed reward authority.');
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const global = await new OnlinePumpSdk(connection).fetchGlobal();
const [first, second] = await Promise.all([
  launchKeys({ global, payer:Keypair.generate().publicKey, programId, authority }),
  launchKeys({ global, payer:Keypair.generate().publicKey, programId, authority }),
]);
const addresses = [...first].filter(address => second.has(address)).map(address => new PublicKey(address));
const execute = process.argv.includes('--execute');
if (!execute) {
  console.log(JSON.stringify({ cluster:'devnet', action:'create-launch-reserve-lookup', signer:signer.publicKey.toBase58(), addresses:addresses.map(address => address.toBase58()), execute:false }));
  process.exit(0);
}
const slot = await connection.getSlot('finalized');
const [createInstruction, tableAddress] = AddressLookupTableProgram.createLookupTable({ authority:signer.publicKey, payer:signer.publicKey, recentSlot:slot });
const extendInstruction = AddressLookupTableProgram.extendLookupTable({ authority:signer.publicKey, payer:signer.publicKey, lookupTable:tableAddress, addresses });
const latest = await connection.getLatestBlockhash('finalized');
const transaction = new Transaction({ feePayer:signer.publicKey, recentBlockhash:latest.blockhash }).add(createInstruction, extendInstruction);
transaction.sign(signer);
const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight:false });
const outcome = await connection.confirmTransaction({ signature, ...latest }, 'finalized');
assert.equal(outcome.value.err, null, 'Lookup table transaction failed.');
const table = (await connection.getAddressLookupTable(tableAddress, { commitment:'finalized' })).value;
assert.ok(table?.state.authority?.equals(signer.publicKey), 'Lookup table authority could not be verified.');
assert.deepEqual(table.state.addresses.map(address => address.toBase58()), addresses.map(address => address.toBase58()));
console.log(JSON.stringify({ cluster:'devnet', address:tableAddress.toBase58(), signature, addresses:addresses.length, execute:true }));
