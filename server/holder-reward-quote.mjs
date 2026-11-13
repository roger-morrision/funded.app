import { PublicKey, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { OnlinePumpAmmSdk, PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { fetchVerifiedPoolSnapshot } from '../pump-trading.js';
import { createSolUsdQuoteReader } from './price-quote.mjs';

// USDC on Mainnet and Devnet: a coin paired with a stablecoin is priced 1:1 in USD.
const STABLE_QUOTES = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU']);

// Devnet dollar figures are reference-equivalent thresholds, never a claim that
// Devnet SOL or a Devnet token has a realizable USD value.
export function createHolderRewardQuoteReader({ connection, env = process.env,
  readSolUsd = createSolUsdQuoteReader(), now = Date.now,
  decodeCurve = account => PUMP_SDK.decodeBondingCurveNullable(account),
  readPool = fetchVerifiedPoolSnapshot, readQuoteUsd = async () => null,
  // Migrated paired coin: reserves of its canonical PumpSwap <coin>/<paired token> pool.
  readPairedPool = async ({ mint, quoteMint }) => {
    const pool = canonicalPumpPoolPda(mint, quoteMint);
    const state = await new OnlinePumpAmmSdk(connection).swapSolanaState(pool, SystemProgram.programId);
    if (!state.poolAccountInfo?.owner?.equals(PUMP_AMM_PROGRAM_ID) || !state.pool?.baseMint?.equals(mint) || !state.pool?.quoteMint?.equals(quoteMint))
      throw new Error('The canonical paired-token pool could not be verified.');
    return { baseAmount: BigInt(state.poolBaseAmount.toString()), quoteAmount: BigInt(state.poolQuoteAmount.toString()) };
  } }) {
  // A coin paired with a token (USDC, an xStock, ...) is priced in that token on
  // its curve; stablecoins count as $1, others need a USD price for the token.
  async function pairedQuote({ curve, mint, mintAccount, decimals }) {
    const quoteMint = curve.quoteMint;
    const quoteAccount = await connection.getParsedAccountInfo(quoteMint, 'finalized');
    const quoteDecimals = Number(quoteAccount.value?.data?.parsed?.info?.decimals);
    if (!Number.isInteger(quoteDecimals)) throw new Error('The paired token decimals are unavailable.');
    const stable = STABLE_QUOTES.has(quoteMint.toBase58());
    const quoteUsd = stable ? 1 : Number(await readQuoteUsd(quoteMint.toBase58()));
    // On the curve: its virtual reserves. After migration: the canonical pool's.
    const reserves = curve.complete ? await readPairedPool({ mint, quoteMint })
      : { baseAmount: BigInt(curve.virtualTokenReserves.toString()), quoteAmount: BigInt(curve.virtualQuoteReserves.toString()) };
    const curveTokens = Number(reserves.baseAmount) / 10 ** decimals;
    const curveQuote = Number(reserves.quoteAmount) / 10 ** quoteDecimals;
    const tokenPriceUsd = curveQuote / curveTokens * quoteUsd;
    if (!Number.isFinite(tokenPriceUsd) || tokenPriceUsd <= 0) throw new Error('A fresh paired-token price quote is unavailable.');
    const supply = Number(mintAccount.value?.data?.parsed?.info?.supply) / 10 ** decimals;
    return { tokenPriceUsd, marketCapUsd:Number.isFinite(supply) && supply >= 0 ? tokenPriceUsd * supply : null, solUsd:null, decimals,
      quoteMint:quoteMint.toBase58(), quoteUsd, quoteDecimals, source:`${curve.complete ? 'finalized-PumpSwap-pool' : 'finalized-Pump-curve'}${stable ? '-in-stablecoin' : '-plus-token-USD'}`,
      observedAt:new Date(now()).toISOString() };
  }
  return async function readHolderRewardQuote(mintAddress) {
    const mint = new PublicKey(mintAddress);
    const [mintAccount, curveAccount, solQuote] = await Promise.all([
      connection.getParsedAccountInfo(mint, 'finalized'),
      connection.getAccountInfo(bondingCurvePda(mint), 'finalized'),
      readSolUsd(env.SOL_USD_PRICE || env.SOLANA_USD_PRICE),
    ]);
    const mintOwner = mintAccount.value?.owner;
    const decimals = Number(mintAccount.value?.data?.parsed?.info?.decimals);
    if ((!mintOwner?.equals(TOKEN_PROGRAM_ID) && !mintOwner?.equals(TOKEN_2022_PROGRAM_ID))
      || !Number.isInteger(decimals) || decimals < 0 || decimals > 18)
      throw new Error('Finalized reward mint and decimals are unavailable.');
    if (!curveAccount?.owner?.equals(PUMP_PROGRAM_ID))
      throw new Error('A finalized Pump bonding curve is unavailable.');
    const curve = decodeCurve(curveAccount);
    if (!curve?.quoteMint?.equals(NATIVE_MINT)
      && !curve?.quoteMint?.equals(SystemProgram.programId))
      return pairedQuote({ curve, mint, mintAccount, decimals });
    const poolPrice = curve.complete
      ? (await readPool({ connection, mint,
          poolAddress:canonicalPumpPoolPda(mint, NATIVE_MINT) })).spotPriceSol
      : null;
    const curveTokens = Number(curve.virtualTokenReserves.toString()) / 10 ** decimals;
    const curveSol = Number(curve.virtualQuoteReserves.toString()) / 1_000_000_000;
    const solPerToken = poolPrice ?? curveSol / curveTokens;
    const solUsd = Number(solQuote?.priceUsd);
    const tokenPriceUsd = solPerToken * solUsd;
    if (!Number.isFinite(tokenPriceUsd) || tokenPriceUsd <= 0
      || !Number.isFinite(solUsd) || solUsd <= 0
      || !Number.isFinite(Date.parse(solQuote?.fetchedAt))
      || Math.abs(now() - Date.parse(solQuote.fetchedAt)) > 5 * 60_000)
      throw new Error('A fresh SOL and token price quote is unavailable.');
    const supply = Number(mintAccount.value?.data?.parsed?.info?.supply) / 10 ** decimals;
    return { tokenPriceUsd, marketCapUsd:Number.isFinite(supply) && supply >= 0 ? tokenPriceUsd * supply : null, solUsd, decimals, source:curve.complete
      ? 'finalized-PumpSwap-reserves-plus-SOL-USD' : 'finalized-Pump-curve-plus-SOL-USD',
      observedAt:new Date(now()).toISOString() };
  };
}
