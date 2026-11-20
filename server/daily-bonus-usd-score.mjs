import { PublicKey, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { bonusUsdMicros } from './daily-bonus-helius-price.mjs';

const USDC_MINTS = Object.freeze({
  devnet:'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  'mainnet-beta':'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
});

export function bonusQuoteAsset(quoteMint, cluster) {
  const quote = new PublicKey(quoteMint).toBase58();
  if (quote === NATIVE_MINT.toBase58() || quote === SystemProgram.programId.toBase58())
    return {asset:'SOL',decimals:9};
  if (quote === USDC_MINTS[cluster]) return {asset:'USDC',decimals:6};
  throw new Error(`No reviewed historical USD price feed exists for bonus quote ${quote}.`);
}

// The exact source units, timestamp and finalized Pyth transaction proof stay
// together in the immutable ranking evidence. Never use a current spot price.
export async function scoreBonusQuoteUsd({ quoteMint, cluster, amountRaw, at, readPrice }) {
  const {asset,decimals}=bonusQuoteAsset(quoteMint,cluster);
  if (!Number.isSafeInteger(at) || at <= 0 || typeof readPrice !== 'function')
    throw new Error('Daily bonus USD scoring requires finalized time and price reader.');
  const priceEvidence=await readPrice({asset,beforeTime:at});
  const scoreUsdMicros=bonusUsdMicros({asset,amountRaw,decimals,tradeTime:at,priceEvidence});
  return { quoteMint:new PublicKey(quoteMint).toBase58(), quoteAsset:asset,
    quoteDecimals:decimals, amountRaw:String(amountRaw), scoreUsdMicros, priceEvidence };
}
