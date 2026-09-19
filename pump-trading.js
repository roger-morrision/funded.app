import BN from 'bn.js';
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from '@pump-fun/pump-sdk';
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, buyQuoteInput, canonicalPumpPoolPda, sellBaseInput } from '@pump-fun/pump-swap-sdk';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const LAMPORTS_PER_SOL = 1_000_000_000;

export const DEFAULT_TRADE_FEE_BPS = 50;

export function buildTradeFeePolicy({ feeOwner, feeBps = DEFAULT_TRADE_FEE_BPS } = {}) {
  const owner = String(feeOwner || '').trim();
  const bps = Number(feeBps);
  if (!owner) return { enabled: false, feeOwner: null, feeBps: bps, reason: 'fee-owner-not-configured' };
  if (!Number.isInteger(bps) || bps < 0 || bps > 500) throw new Error('Trade fee must be an integer from 0 to 500 bps.');
  return { enabled: bps > 0, feeOwner: requireMint(owner).toBase58(), feeBps: bps, percent: bps / 100 };
}

export function assertTradeConfirmed(confirmation) {
  if (!confirmation?.value || confirmation.value.err) throw new Error(`Trade did not confirm successfully${confirmation?.value?.err ? `: ${JSON.stringify(confirmation.value.err)}` : '.'}`);
}

export function describeTradeQuote(trade, slippagePercent) {
  const outputDecimals = trade.side === 'buy' ? trade.tokenDecimals : 9;
  const expected = Number(trade.outputAmount.toString()) / (10 ** outputDecimals);
  const slippageBps = Math.round(Number(slippagePercent) * 100);
  const floorAmount = trade.minimumOutputAmount || new BN(((BigInt(trade.outputAmount.toString()) * BigInt(10_000 - slippageBps)) / 10_000n).toString());
  const minimum = Number(floorAmount.toString()) / (10 ** outputDecimals);
  return { expected, minimum, outputSymbol: trade.side === 'buy' ? 'tokens' : 'SOL', appFeeSol: trade.feeLamports / LAMPORTS_PER_SOL, route: trade.route || 'curve' };
}

function calculateTradeFee(lamports, feePolicy) {
  const fee = (BigInt(lamports.toString()) * BigInt(feePolicy.feeBps) + 9_999n) / 10_000n;
  if (fee > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Trade fee is too large to transfer safely.');
  return Number(fee);
}

function tradeUnits(amount, decimals) {
  const units = Math.round(Number(amount) * (10 ** decimals));
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('Trade amount is too small or too large for safe precision.');
  return new BN(units);
}

function requireMint(mint) {
  return mint instanceof PublicKey ? mint : new PublicKey(String(mint || '').trim());
}

function bnToNumber(value, decimals = 9) {
  return Number(value?.toString?.() || 0) / (10 ** decimals);
}

function poolQuoteArgs(state) {
  return {
    baseReserve: state.poolBaseAmount,
    quoteReserve: state.poolQuoteAmount,
    virtualQuoteReserves: state.pool.virtualQuoteReserves,
    globalConfig: state.globalConfig,
    feeConfig: state.feeConfig,
    baseMint: state.baseMint,
    baseMintAccount: state.baseMintAccount,
    coinCreator: state.pool.coinCreator,
    creator: state.pool.creator,
    quoteMint: state.pool.quoteMint,
    isMayhemMode: state.pool.isMayhemMode,
    creatorFeeBps: state.pool.creatorFeeBps,
  };
}

async function buildGraduatedTrade({ connection, side, mintKey, userKey, amount, slippage, tokenDecimals, feePolicy, snapshot }) {
  const poolKey = canonicalPumpPoolPda(mintKey, NATIVE_MINT);
  const pool = await new OnlinePumpAmmSdk(connection).swapSolanaState(poolKey, userKey);
  if (!pool.poolAccountInfo || !pool.pool.baseMint.equals(mintKey) || !pool.pool.quoteMint.equals(NATIVE_MINT) || pool.poolBaseAmount.lte(new BN(0)) || pool.poolQuoteAmount.lte(new BN(0))) throw new Error('A verified SOL-quoted graduated pool is unavailable.');
  const args = poolQuoteArgs(pool);
  if (side === 'buy') {
    const solAmount = tradeUnits(amount, 9);
    const quoted = buyQuoteInput({ ...args, quote: solAmount, slippage });
    if (quoted.base.lte(new BN(0))) throw new Error('The pool quote has no token output.');
    const instructions = await PUMP_AMM_SDK.buyQuoteInput(pool, solAmount, slippage);
    const feeLamports = calculateTradeFee(solAmount, feePolicy);
    instructions.push(SystemProgram.transfer({ fromPubkey: userKey, toPubkey: new PublicKey(feePolicy.feeOwner), lamports: feeLamports }));
    return { route: 'graduated-pool', side, mint: mintKey, user: userKey, inputAmount: Number(amount), slippagePercent: slippage, instructions, quoteAmount: solAmount, outputAmount: quoted.base, minimumOutputAmount: quoted.base, tokenDecimals, feeLamports, feePolicy, snapshot, pool: poolKey.toBase58() };
  }
  const tokenAmount = tradeUnits(amount, tokenDecimals);
  const quoted = sellBaseInput({ ...args, base: tokenAmount, slippage });
  if (quoted.uiQuote.lte(new BN(0)) || quoted.minQuote.lte(new BN(0))) throw new Error('The pool quote has no SOL output.');
  const instructions = await PUMP_AMM_SDK.sellBaseInput(pool, tokenAmount, slippage);
  const feeLamports = calculateTradeFee(quoted.uiQuote, feePolicy);
  instructions.push(SystemProgram.transfer({ fromPubkey: userKey, toPubkey: new PublicKey(feePolicy.feeOwner), lamports: feeLamports }));
  return { route: 'graduated-pool', side, mint: mintKey, user: userKey, inputAmount: Number(amount), slippagePercent: slippage, instructions, quoteAmount: quoted.uiQuote, outputAmount: quoted.uiQuote, minimumOutputAmount: quoted.minQuote, tokenDecimals, feeLamports, feePolicy, snapshot, pool: poolKey.toBase58() };
}

export function formatBondingCurveSnapshot({ mint, bondingCurve, slot = null, observedAt = new Date().toISOString() }) {
  if (!bondingCurve) throw new Error('Bonding curve data is unavailable.');
  const virtualToken = bnToNumber(bondingCurve.virtualTokenReserves, 6);
  const virtualQuote = bnToNumber(bondingCurve.virtualQuoteReserves, 9);
  const realToken = bnToNumber(bondingCurve.realTokenReserves, 6);
  const realQuote = bnToNumber(bondingCurve.realQuoteReserves, 9);
  return {
    mint: requireMint(mint).toBase58(),
    complete: Boolean(bondingCurve.complete),
    virtualTokenReserves: virtualToken,
    virtualQuoteReservesSol: virtualQuote,
    realTokenReserves: realToken,
    realQuoteReservesSol: realQuote,
    progressPercent: virtualToken > 0 ? Math.max(0, Math.min(100, (1 - realToken / virtualToken) * 100)) : 0,
    creator: bondingCurve.creator?.toBase58?.() || String(bondingCurve.creator || ''),
    quoteMint: bondingCurve.quoteMint?.toBase58?.() || String(bondingCurve.quoteMint || ''),
    slot,
    observedAt,
  };
}

export async function fetchBondingCurveSnapshot({ connection, mint }) {
  const mintKey = requireMint(mint);
  const sdk = new OnlinePumpSdk(connection);
  const [bondingCurve, slot] = await Promise.all([
    sdk.fetchBondingCurve(mintKey),
    connection.getSlot('confirmed'),
  ]);
  return formatBondingCurveSnapshot({ mint: mintKey, bondingCurve, slot });
}

export async function buildTradeTransaction({ connection, side, mint, user, amount, slippagePercent = 1, feeOwner, feeBps = DEFAULT_TRADE_FEE_BPS }) {
  const mintKey = requireMint(mint);
  const userKey = user instanceof PublicKey ? user : new PublicKey(String(user || '').trim());
  const slippage = Number(slippagePercent);
  if (!['buy', 'sell'].includes(side)) throw new Error('Trade side must be buy or sell.');
  if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 10) throw new Error('Slippage must be between 0 and 10%.');
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('Trade amount must be positive.');
  const feePolicy = buildTradeFeePolicy({ feeOwner, feeBps });
  if (!feePolicy.enabled) throw new Error('Trading is disabled until the app owner fee wallet is configured.');

  const sdk = new OnlinePumpSdk(connection);
  const global = await sdk.fetchGlobal();
  const mintAccount = await connection.getParsedAccountInfo(mintKey, 'confirmed');
  const tokenProgram = mintAccount.value?.owner;
  if (!tokenProgram || (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Token program could not be verified.');
  const tokenDecimals = Number(mintAccount.value?.data?.parsed?.info?.decimals);
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) throw new Error('Token decimals could not be verified.');
  const state = side === 'buy' ? await sdk.fetchBuyState(mintKey, userKey, tokenProgram) : await sdk.fetchSellState(mintKey, userKey, tokenProgram);
  const snapshot = formatBondingCurveSnapshot({ mint: mintKey, bondingCurve: state.bondingCurve });
  if (state.bondingCurve.complete) return buildGraduatedTrade({ connection, side, mintKey, userKey, amount, slippage, tokenDecimals, feePolicy, snapshot });
  if (!state.quoteMint?.equals?.(NATIVE_MINT)) throw new Error('This trade is not quoted in SOL.');

  if (side === 'buy') {
    const solAmount = tradeUnits(amount, 9);
    const tokenAmount = getBuyTokenAmountFromSolAmount({ global, bondingCurve: state.bondingCurve, amount: solAmount });
    const instructions = await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo: state.bondingCurveAccountInfo,
      bondingCurve: state.bondingCurve,
      associatedUserAccountInfo: state.associatedUserAccountInfo,
      mint: mintKey,
      user: userKey,
      amount: tokenAmount,
      quoteAmount: solAmount,
      slippage,
      tokenProgram,
      quoteMint: state.quoteMint,
      quoteTokenProgram: state.quoteTokenProgram,
    });
    const feeLamports = calculateTradeFee(solAmount, feePolicy);
    instructions.push(SystemProgram.transfer({ fromPubkey: userKey, toPubkey: new PublicKey(feePolicy.feeOwner), lamports: feeLamports }));
    return { route: 'curve', side, mint: mintKey, user: userKey, inputAmount: Number(amount), slippagePercent: slippage, instructions, quoteAmount: solAmount, outputAmount: tokenAmount, tokenDecimals, feeLamports, feePolicy, snapshot };
  }

  const tokenAmount = tradeUnits(amount, tokenDecimals);
  const solAmount = getSellSolAmountFromTokenAmount({ global, bondingCurve: state.bondingCurve, amount: tokenAmount });
  const instructions = await PUMP_SDK.sellV2Instructions({
    global,
    bondingCurveAccountInfo: state.bondingCurveAccountInfo,
    bondingCurve: state.bondingCurve,
    mint: mintKey,
    user: userKey,
    amount: tokenAmount,
    quoteAmount: solAmount,
    slippage,
    tokenProgram,
    quoteMint: state.quoteMint,
    quoteTokenProgram: state.quoteTokenProgram,
  });
  const feeLamports = calculateTradeFee(solAmount, feePolicy);
  instructions.push(SystemProgram.transfer({ fromPubkey: userKey, toPubkey: new PublicKey(feePolicy.feeOwner), lamports: feeLamports }));
  return { route: 'curve', side, mint: mintKey, user: userKey, inputAmount: Number(amount), slippagePercent: slippage, instructions, quoteAmount: solAmount, outputAmount: solAmount, tokenDecimals, feeLamports, feePolicy, snapshot };
}

export async function submitTrade({ connection, provider, side, mint, user, amount, slippagePercent = 1, feeOwner, feeBps = DEFAULT_TRADE_FEE_BPS, preparedTrade = null, onStatus = () => {} }) {
  if (!provider?.signTransaction) throw new Error('Connect a wallet that can sign transactions.');
  onStatus(`Reading ${side} quote and Solana state…`);
  const trade = preparedTrade || await buildTradeTransaction({ connection, side, mint, user, amount, slippagePercent, feeOwner, feeBps });
  if (trade.side !== side || !trade.mint.equals(requireMint(mint)) || !trade.user.equals(requireMint(user)) || trade.inputAmount !== Number(amount) || trade.slippagePercent !== Number(slippagePercent)) throw new Error('The trade quote no longer matches the selected trade.');
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ recentBlockhash: latest.blockhash, feePayer: user }).add(...trade.instructions);
  onStatus('Waiting for wallet approval…');
  const signed = await provider.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  onStatus('Confirming trade on Solana Devnet…');
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  assertTradeConfirmed(confirmation);
  return { ...trade, signature, confirmedAt: new Date().toISOString() };
}
