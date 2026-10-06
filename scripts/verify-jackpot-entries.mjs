import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { jackpotWindow } from '../server/jackpot-model.mjs';
import { verifyJackpotCreatorEntry, verifyJackpotTraderEntry } from '../server/jackpot-entry-verification.mjs';
import { verifyTraderJackpotFunding } from '../server/jackpot-funding-verification.mjs';
import { prepareJackpotRound } from '../server/jackpot-round.mjs';

const window = jackpotWindow(1_728_000_000);
const trader = Keypair.generate().publicKey.toBase58();
const owner = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const signature = bs58.encode(randomBytes(64));
const buyData = bs58.encode(Buffer.concat([
  createHash('sha256').update('global:buy').digest().subarray(0, 8), Buffer.alloc(8),
]));
const transfer = { program:'system', parsed:{ type:'transfer', info:{
  source:trader, destination:owner, lamports:50_000 } } };
const buy = { programId:PUMP_PROGRAM_ID, accounts:[trader, mint], data:buyData };
const tx = { blockTime:window.start + 10, meta:{ err:null },
  transaction:{ message:{ accountKeys:[{ pubkey:trader, signer:true }],
    instructions:[buy, transfer] } } };
const rpc = { getGenesisHash:async () => 'mock-devnet-genesis',
  getParsedTransaction:async () => tx };
const input = { connection:rpc, expectedGenesisHash:'mock-devnet-genesis',
  signature, feeOwner:owner, window };
const receipt = await verifyJackpotTraderEntry(input);
assert.equal(receipt.traderWallet, trader);
assert.equal(receipt.feeLamports, '50000');
assert.equal(receipt.finalized, true);
await assert.rejects(verifyJackpotTraderEntry({ ...input,
  expectedGenesisHash:'wrong' }), /Trusted Solana RPC/);
await assert.rejects(verifyJackpotTraderEntry({ ...input,
  connection:{ ...rpc, getParsedTransaction:async () => ({ ...tx, blockTime:window.end }) } }), /outside/);
await assert.rejects(verifyJackpotTraderEntry({ ...input,
  connection:{ ...rpc, getParsedTransaction:async () => ({ ...tx,
    transaction:{ message:{ ...tx.transaction.message, instructions:[transfer] } } }) } }), /matching Pump/);
await assert.rejects(verifyJackpotTraderEntry({ ...input,
  connection:{ ...rpc, getParsedTransaction:async () => ({ ...tx,
    transaction:{ message:{ ...tx.transaction.message, instructions:[buy, transfer, transfer] } } }) } }), /Exactly one/);
await assert.rejects(verifyJackpotTraderEntry({ ...input,
  connection:{ ...rpc, getParsedTransaction:async () => ({ ...tx,
    transaction:{ message:{ ...tx.transaction.message,
      accountKeys:[{ pubkey:trader, signer:false }] } } }) } }), /did not sign/);
await assert.rejects(verifyJackpotCreatorEntry({ connection:rpc,
  expectedGenesisHash:'mock-devnet-genesis', appLaunch:null, window }), /registered/);
const vault = Keypair.generate().publicKey.toBase58();
const fundingSignature = bs58.encode(randomBytes(64));
const fundingTx = { blockTime:window.start + 11, meta:{ err:null, fee:5_000,
  preBalances:[1_000_000, 0], postBalances:[992_500, 2_500] },
transaction:{ message:{ accountKeys:[{ pubkey:owner, signer:true },
  { pubkey:vault, signer:false }], instructions:[{ program:'system',
    parsed:{ type:'transfer', info:{ source:owner, destination:vault,
      lamports:2_500 } } }] } } };
const fundingRpc = { ...rpc, getParsedTransaction:async inputSignature =>
  inputSignature === fundingSignature ? fundingTx : tx };
const fundingInput = { connection:fundingRpc, expectedGenesisHash:'mock-devnet-genesis',
  sourceSignatures:[signature], fundingSignature, feeOwner:owner, vault, window };
const funding = await verifyTraderJackpotFunding(fundingInput);
assert.equal(funding.sourceFeeLamports, '50000');
assert.equal(funding.transferLamports, '2500');
assert.equal(funding.feeSourceVerified, true);
const round = prepareJackpotRound({ kind:'trader', window,
  nowSeconds:window.end + 2, entryReceipts:[receipt],
  contributionReceipts:[funding], vault,
  entropyProof:{ cluster:'devnet', finalized:true, independent:true,
    sourceSignature:bs58.encode(randomBytes(64)), blockTime:window.end + 1,
    entropyHex:randomBytes(32).toString('hex') } });
assert.equal(round.prizeLamports, '2500');
assert.equal(round.winner, trader);
await assert.rejects(verifyTraderJackpotFunding({ ...fundingInput,
  sourceSignatures:[signature, signature] }), /invalid/);
await assert.rejects(verifyTraderJackpotFunding({ ...fundingInput,
  connection:{ ...fundingRpc, getParsedTransaction:async inputSignature =>
    inputSignature === fundingSignature ? { ...fundingTx, meta:{ ...fundingTx.meta,
      postBalances:[992_500, 2_499] } } : tx } }), /balance changes/);
console.log('Jackpot entry and trader funding verification passed: finalized fee, signer, Pump instruction, vault transfer, and rejection paths (mock RPC).');
