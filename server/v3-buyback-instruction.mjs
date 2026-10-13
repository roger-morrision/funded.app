import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { deriveFeeRouter } from '../fee-router.js';
import { deriveMintPolicyV3, deriveMintVaultsV3 } from '../mint-router-v3.js';

export const V3_DEVNET_FUNDED_MINT = new PublicKey('C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64');
export const V3_DEVNET_FUNDED_POOL = new PublicKey('EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32');
const PUMP_BUY = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const BUYBACK_SEED = Buffer.from('mint-buyback-v3');
const UINT64_MAX = (1n << 64n) - 1n;

function u64(value, label) {
  const number = BigInt(value);
  if (number <= 0n || number > UINT64_MAX) throw new Error(`${label} is outside the u64 range.`);
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(number);
  return bytes;
}

export function v3BuybackId(sourceCollectionSignatures) {
  const ids = [...new Set(sourceCollectionSignatures)].sort();
  if (!ids.length || ids.some(id => !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(id)))
    throw new Error('V3 buyback requires finalized source collection signatures.');
  return createHash('sha256').update(`funded.v3.buyback.v1:${ids.join(',')}`).digest();
}

// The Pump instruction supplies current pool fee accounts only. The router
// constructs its own exact-quote CPI and verifies every custody address.
export function buildV3BuybackInstruction({ programId, sourceMint, authority,
  creator, baseTokenProgram, buybackId, spendableQuoteIn,
  minBaseAmountOut, maxTotalDebit, pumpBuyInstruction }) {
  const program = new PublicKey(programId);
  const mint = new PublicKey(sourceMint);
  const baseProgram = new PublicKey(baseTokenProgram);
  if (!baseProgram.equals(TOKEN_PROGRAM_ID) && !baseProgram.equals(TOKEN_2022_PROGRAM_ID))
    throw new Error('Buyback mint token program is unsupported.');
  const id = Buffer.from(buybackId);
  if (id.length !== 32) throw new Error('Buyback ID must contain 32 bytes.');
  const quote = u64(spendableQuoteIn, 'Spendable buyback quote');
  const floor = u64(minBaseAmountOut, 'Minimum bought tokens');
  const limit = u64(maxTotalDebit, 'Maximum buyback debit');
  if (BigInt(maxTotalDebit) < BigInt(spendableQuoteIn))
    throw new Error('Maximum buyback debit is lower than the protected quote.');
  const vault = deriveMintVaultsV3(program, mint)[6];
  const fundedAta = getAssociatedTokenAddressSync(V3_DEVNET_FUNDED_MINT,
    vault, true, baseProgram);
  const quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT, vault, true,
    TOKEN_PROGRAM_ID);
  const buy = pumpBuyInstruction;
  const expected = [
    [0, V3_DEVNET_FUNDED_POOL], [1, vault],
    [3, V3_DEVNET_FUNDED_MINT], [4, NATIVE_MINT],
    [5, fundedAta], [6, quoteAta], [11, baseProgram],
    [12, TOKEN_PROGRAM_ID], [13, SystemProgram.programId],
    [14, ASSOCIATED_TOKEN_PROGRAM_ID], [16, PUMP_AMM_PROGRAM_ID],
  ];
  if (!buy?.programId?.equals(PUMP_AMM_PROGRAM_ID)
    || !Buffer.from(buy.data || []).subarray(0, 8).equals(PUMP_BUY)
    || !Array.isArray(buy.keys) || buy.keys.length < 25 || buy.keys.length > 27
    || expected.some(([index, address]) => !buy.keys[index]?.pubkey?.equals(address)))
    throw new Error('PumpSwap buy instruction does not use the approved Devnet market and vault custody.');
  const policy = deriveMintPolicyV3(program, mint).address;
  const legacy = deriveFeeRouter(program).address;
  const receipt = PublicKey.findProgramAddressSync([
    BUYBACK_SEED, mint.toBuffer(), id ], program)[0];
  const data = Buffer.concat([
    createHash('sha256').update('global:buyback_mint_v3').digest().subarray(0, 8),
    id, quote, floor, limit,
  ]);
  const keys = [
    { pubkey:new PublicKey(authority), isSigner:true, isWritable:true },
    { pubkey:new PublicKey(creator), isSigner:true, isWritable:false },
    { pubkey:mint, isSigner:false, isWritable:false },
    { pubkey:legacy, isSigner:false, isWritable:false },
    { pubkey:policy, isSigner:false, isWritable:true },
    { pubkey:vault, isSigner:false, isWritable:true },
    { pubkey:V3_DEVNET_FUNDED_MINT, isSigner:false, isWritable:true },
    { pubkey:fundedAta, isSigner:false, isWritable:true },
    { pubkey:quoteAta, isSigner:false, isWritable:true },
    { pubkey:V3_DEVNET_FUNDED_POOL, isSigner:false, isWritable:true },
    { pubkey:receipt, isSigner:false, isWritable:true },
    { pubkey:baseProgram, isSigner:false, isWritable:false },
    { pubkey:TOKEN_PROGRAM_ID, isSigner:false, isWritable:false },
    { pubkey:ASSOCIATED_TOKEN_PROGRAM_ID, isSigner:false, isWritable:false },
    { pubkey:PUMP_AMM_PROGRAM_ID, isSigner:false, isWritable:false },
    { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
    ...buy.keys.map((entry, index) => ({ ...entry,
      isSigner:index === 1 ? false : entry.isSigner })),
  ];
  return { instruction:new TransactionInstruction({ programId:program, keys, data }),
    vault, fundedAta, quoteAta, policy, receipt, buybackId:id,
    spendableQuoteIn:String(spendableQuoteIn), minBaseAmountOut:String(minBaseAmountOut),
    maxTotalDebit:String(maxTotalDebit) };
}
