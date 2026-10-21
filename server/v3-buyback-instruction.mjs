import {DEFAULT_AGENCY_RULES,validateAgencyRules} from '../config/agency-rules.js';
import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { deriveFeeRouter } from '../fee-router.js';
import { deriveMintPolicyV3, deriveMintVaultsV3 } from '../mint-router-v3.js';
import {deriveAgencyPolicyV3,deriveAgencyVaultsV3,agencyDiscriminator,agencyU64} from '../agency-mint-router-v3.js';

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

export function v3BuybackId(sourceCollectionSignatures, round = 1) {
  const ids = [...new Set(sourceCollectionSignatures)].sort();
  if (!ids.length || ids.some(id => !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(id)))
    throw new Error('V3 buyback requires finalized source collection signatures.');
  if (!Number.isSafeInteger(round) || round < 1)
    throw new Error('V3 buyback round must be a positive integer.');
  const suffix = round === 1 ? '' : `:round:${round}`;
  return createHash('sha256').update(`funded.v3.buyback.v1:${ids.join(',')}${suffix}`).digest();
}

export function v3BuybackOnchainId(mint, round = 1) {
  const source = new PublicKey(mint).toBase58();
  if (!Number.isSafeInteger(round) || round < 1)
    throw new Error('V3 buyback round must be a positive integer.');
  return createHash('sha256').update(`funded.v3.buyback.onchain.v1:${source}:round:${round}`).digest();
}

// The Pump instruction supplies current pool fee accounts only. The router
// constructs its own exact-quote CPI and verifies every custody address.
export function buildV3BuybackInstruction({ programId, sourceMint, authority,
  creator, baseTokenProgram, buybackId, spendableQuoteIn,
  minBaseAmountOut, maxTotalDebit, pumpBuyInstruction,agencyPolicy=false,agencyExecution=null }) {
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
  const own=agencyPolicy&&agencyExecution!==null;
  if(agencyExecution&&!agencyPolicy)throw new Error('Agency execution requires its immutable eight-category policy.');
  if(own&&![1,2].includes(agencyExecution.agent))throw new Error('Only own-coin milestone agents may use the agency burn budget.');
  const category=own?7:6,agent=own?agencyExecution.agent:255;
  const boughtMint=own?mint:V3_DEVNET_FUNDED_MINT,pool=own?new PublicKey(agencyExecution.pool):V3_DEVNET_FUNDED_POOL;
  const vault = (agencyPolicy?deriveAgencyVaultsV3:deriveMintVaultsV3)(program, mint)[category];
  const fundedAta = getAssociatedTokenAddressSync(boughtMint,
    vault, true, baseProgram);
  const quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT, vault, true,
    TOKEN_PROGRAM_ID);
  const buy = pumpBuyInstruction;
  const expected = [
    [0, pool], [1, vault],
    [3, boughtMint], [4, NATIVE_MINT],
    [5, fundedAta], [6, quoteAta], [11, baseProgram],
    [12, TOKEN_PROGRAM_ID], [13, SystemProgram.programId],
    [14, ASSOCIATED_TOKEN_PROGRAM_ID], [16, PUMP_AMM_PROGRAM_ID],
  ];
  if (!buy?.programId?.equals(PUMP_AMM_PROGRAM_ID)
    || !Buffer.from(buy.data || []).subarray(0, 8).equals(PUMP_BUY)
    || !Array.isArray(buy.keys) || buy.keys.length < 25 || buy.keys.length > 27
    || expected.some(([index, address]) => !buy.keys[index]?.pubkey?.equals(address)))
    throw new Error('PumpSwap buy instruction does not use the approved Devnet market and vault custody.');
  const policy = (agencyPolicy?deriveAgencyPolicyV3:deriveMintPolicyV3)(program, mint).address;
  const legacy = deriveFeeRouter(program).address;
  const receipt = PublicKey.findProgramAddressSync([
    BUYBACK_SEED, mint.toBuffer(), id ], program)[0];
  let data;
  if(agencyPolicy){
    const attest=Buffer.alloc(58);attest[0]=category;attest[1]=agent;
    if(own){
      const slot=agencyU64(agencyExecution.observationSlot,{positive:true}),cap=agencyU64(agencyExecution.marketCapUsdMicros,{positive:true});
      const hash=Buffer.from(agencyExecution.observationHash||[]),time=agencyExecution.observedAt;
      if(hash.length!==32||hash.equals(Buffer.alloc(32))||!Number.isSafeInteger(time)||time<1
        ||cap<BigInt(validateAgencyRules(agencyExecution.rules||DEFAULT_AGENCY_RULES).marketCapUsd[agent-1])*1000000n)throw new Error('A verified milestone observation is required.');
      attest.writeBigUInt64LE(slot,2);attest.writeBigInt64LE(BigInt(time),10);attest.writeBigUInt64LE(cap,18);hash.copy(attest,26);
    }
    data=Buffer.concat([agencyDiscriminator('buyback_agency_mint_v3'),id,attest,quote,floor,limit]);
  }else data=Buffer.concat([createHash('sha256').update('global:buyback_mint_v3').digest().subarray(0,8),id,quote,floor,limit]);
  const keys = [
    { pubkey:new PublicKey(authority), isSigner:true, isWritable:true },
    { pubkey:new PublicKey(creator), isSigner:false, isWritable:false },
    { pubkey:mint, isSigner:false, isWritable:false },
    { pubkey:legacy, isSigner:false, isWritable:false },
    { pubkey:policy, isSigner:false, isWritable:true },
    { pubkey:vault, isSigner:false, isWritable:true },
    { pubkey:boughtMint, isSigner:false, isWritable:true },
    { pubkey:fundedAta, isSigner:false, isWritable:true },
    { pubkey:quoteAta, isSigner:false, isWritable:true },
    { pubkey:pool, isSigner:false, isWritable:true },
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
    maxTotalDebit:String(maxTotalDebit),...(agencyPolicy?{agencyPolicy:true,category,agent,boughtMint,pool}: {}) };
}
