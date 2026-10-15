import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { fetchVerifiedPoolSnapshot } from '../pump-trading.js';
import { createSolUsdQuoteReader } from './price-quote.mjs';

// Devnet dollar figures are reference-equivalent thresholds, never a claim that
// Devnet SOL or a Devnet token has a realizable USD value.
export function createHolderRewardQuoteReader({ connection, env = process.env,
  readSolUsd = createSolUsdQuoteReader(), now = Date.now,
  decodeCurve = account => PUMP_SDK.decodeBondingCurveNullable(account),
  readPool = fetchVerifiedPoolSnapshot }) {
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
    if (!curve?.quoteMint?.equals(NATIVE_MINT))
      throw new Error('Holder rewards require a verified SOL-quoted Pump market.');
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
    return { tokenPriceUsd, solUsd, decimals, source:curve.complete
      ? 'finalized-PumpSwap-reserves-plus-SOL-USD' : 'finalized-Pump-curve-plus-SOL-USD',
      observedAt:new Date(now()).toISOString() };
  };
}
