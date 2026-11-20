import { formatTradeAmountInput, parseTradeAmountInput } from '../../../trade-amount-input.js';
import { formatTokenBaseAmount } from '../../../trade-panel-balance.js';
import { hasBuyBalance, hasBuyQuoteBalance } from '../../../trade-spend-guard.js';
import { estimateBuyTokenAmountFromSnapshot } from '../../../trade-quote-display.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderRoundTripAction(
  {
    tradeActionBusy,
  },
  {
    captureWalletSession,
    savedRoundTrip,
    document = globalThis.document,
  } = {}
) {
  const button = document.querySelector('#trade-roundtrip-share');
  if (!button) return;
  const session = captureWalletSession(), mint = document.querySelector('#trade-mint')?.value.trim();
  const pair = session && mint ? savedRoundTrip(session.address, mint) : null;
  button.hidden = tradeActionBusy || !pair?.buySignature || !pair?.sellSignature;
}

export function renderTradeBalances(
  {
    tradeBalanceState,
    coinTradeEstimate,
    wallet,
    TRADE_FEE_BPS,
  },
  {
    renderRoundTripAction,
    tradeBalanceKey,
    tradeInputs,
    currentTradePreview,
    updateTradeActionState,
    document = globalThis.document,
  } = {}
) {
  renderRoundTripAction();
  const node = document.querySelector('#trade-wallet-balance');
  if (!node) return;
  const warning = document.querySelector('#trade-balance-warning');
  const side = document.querySelector('#trade-side')?.value;
  const current = Boolean(tradeBalanceState.key && tradeBalanceState.key === tradeBalanceKey());
  const symbol = coinTradeEstimate?.symbol || document.querySelector('#coin-symbol')?.textContent?.trim() || 'token';
  const paired = Boolean(coinTradeEstimate?.quoteMint);
  const quoteSymbol = coinTradeEstimate?.quoteSymbol || 'paired token';
  if (!wallet) node.textContent = 'Connect wallet';
  else if (!current) node.textContent = 'Checking balance…';
  else if (side === 'sell') node.textContent = tradeBalanceState.tokenRaw == null ? 'Balance unavailable' : `${formatTradeAmountInput(formatTokenBaseAmount(tradeBalanceState.tokenRaw, tradeBalanceState.tokenDecimals, Math.min(9, tradeBalanceState.tokenDecimals)))} ${symbol}`;
  else if (paired) node.textContent = tradeBalanceState.quoteRaw == null || !Number.isInteger(tradeBalanceState.quoteDecimals)
    ? 'Balance unavailable' : `${formatTradeAmountInput(formatTokenBaseAmount(tradeBalanceState.quoteRaw, tradeBalanceState.quoteDecimals, Math.min(9, tradeBalanceState.quoteDecimals)))} ${quoteSymbol}`;
  else node.textContent = tradeBalanceState.solLamports == null ? 'Balance unavailable' : `${formatTradeAmountInput(formatTokenBaseAmount(tradeBalanceState.solLamports, 9, 6))} SOL`;
  document.querySelectorAll('[data-coin-sell-percent]').forEach(button => { button.disabled = !current || tradeBalanceState.tokenRaw == null || tradeBalanceState.tokenRaw <= 0n; });
  const amount = parseTradeAmountInput(document.querySelector('#trade-amount')?.value);
  const inputs = tradeInputs();
  const preview = currentTradePreview(inputs);
  const insufficient = current && Number.isFinite(amount) && amount > 0 && (side === 'buy'
    ? paired ? tradeBalanceState.quoteRaw != null && !hasBuyQuoteBalance(tradeBalanceState, { amount, quoteDecimals:tradeBalanceState.quoteDecimals,
      slippagePercent:inputs.slippagePercent, feeBps:TRADE_FEE_BPS, trade:preview?.trade })
      : tradeBalanceState.solLamports != null && !hasBuyBalance(tradeBalanceState.solLamports, { amountSol:amount, slippagePercent:inputs.slippagePercent, feeBps:TRADE_FEE_BPS, trade:preview?.trade })
    : tradeBalanceState.tokenRaw != null && amount > Number(tradeBalanceState.tokenRaw) / (10 ** tradeBalanceState.tokenDecimals));
  if (warning) { warning.hidden = !insufficient; warning.textContent = side === 'buy' ? paired
    ? `Insufficient ${quoteSymbol} for maximum spend and app fee, or SOL for network/account costs.`
    : 'Insufficient SOL for maximum spend, app fee, and network/account allowance.' : `Insufficient ${symbol} balance.`; }
  updateTradeActionState();
}

export function renderTradeAmountEstimate(
  {
    tradePreview,
    wallet,
    coinTradeEstimate,
  },
  {
    tradeInputs,
    captureWalletSession,
    formatTradeEstimateAmount,
    document = globalThis.document,
  } = {}
) {
  const card = document.querySelector('#trade-live-estimate');
  const amountNode = document.querySelector('#trade-live-amount');
  const detailNode = document.querySelector('#trade-live-detail');
  if (!card || !amountNode || !detailNode) return;
  const side = document.querySelector('#trade-side')?.value;
  const paired = Boolean(coinTradeEstimate?.quoteMint);
  const quoteSymbol = coinTradeEstimate?.quoteSymbol || 'paired token';
  card.hidden = false;
  card.querySelector('span').textContent = side === 'sell' ? `Estimated ${paired ? quoteSymbol : 'SOL'} received` : 'Estimated tokens received';
  const amountSol = parseTradeAmountInput(document.querySelector('#trade-amount')?.value);
  const mint = document.querySelector('#trade-mint')?.value.trim();
  const input = tradeInputs();
  const session = captureWalletSession();
  if (tradePreview?.inputKey === `${input.mint}:${input.side}:${input.amount}:${input.slippagePercent}:${session?.address || ''}` && Date.now() - tradePreview.preparedAt < 15_000) return;
  card.classList.remove('is-ready', 'is-unavailable');
  if (side === 'sell') {
    amountNode.textContent = Number.isFinite(amountSol) && amountSol > 0 ? wallet ? `Calculating ${paired ? quoteSymbol : 'SOL'}…` : 'Connect wallet for quote' : 'Enter a token amount';
    detailNode.textContent = 'The live quote includes the app fee and slippage floor.';
    return;
  }
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    amountNode.textContent = `Enter a ${paired ? quoteSymbol : 'SOL'} amount`;
    detailNode.textContent = 'Your estimated token amount will appear here.';
    return;
  }
  if (!coinTradeEstimate || coinTradeEstimate.mint !== mint) {
    amountNode.textContent = 'Reading market reserves…';
    detailNode.textContent = 'The estimate appears after the on-chain snapshot is verified.';
    return;
  }
  if (paired) {
    amountNode.textContent = wallet ? 'Calculating paired-token quote…' : 'Connect wallet for quote';
    detailNode.textContent = 'The live on-chain quote includes the paired-token app fee and slippage.';
    return;
  }
  if (coinTradeEstimate.priceUsd > 0 && coinTradeEstimate.solUsd > 0 && !coinTradeEstimate.curve && !coinTradeEstimate.graduatedPool) {
    amountNode.textContent = `≈ ${formatTradeEstimateAmount(amountSol * coinTradeEstimate.solUsd / coinTradeEstimate.priceUsd)} ${coinTradeEstimate.symbol}`;
    detailNode.textContent = '';
    card.classList.add('is-ready');
    return;
  }
  try {
    const estimate = estimateBuyTokenAmountFromSnapshot({ amountSol, curveSnapshot: coinTradeEstimate.curve, graduatedPoolSnapshot: coinTradeEstimate.graduatedPool });
    amountNode.textContent = `≈ ${formatTradeEstimateAmount(estimate.expectedTokens)} ${coinTradeEstimate.symbol}`;
    detailNode.textContent = `${estimate.route === 'graduated-pool' ? 'PumpSwap pool' : 'Pump curve'} reserve estimate · A live quote adds fees and slippage.`;
    card.classList.add('is-ready');
  } catch (error) {
    amountNode.textContent = 'Estimate unavailable';
    detailNode.textContent = error.message;
    card.classList.add('is-unavailable');
  }
}

export function updateTradeAmountLabel(
  {
    coinTradeEstimate,
  },
  {
    renderTradeBalances,
    renderTradeAmountEstimate,
    document = globalThis.document,
  } = {}
) {
  const side = document.querySelector('#trade-side')?.value;
  const paired = Boolean(coinTradeEstimate?.quoteMint);
  const quoteSymbol = coinTradeEstimate?.quoteSymbol || 'paired token';
  const panel = document.querySelector('#trade-panel');
  if (panel) panel.dataset.side = side;
  const label = document.querySelector('#trade-amount-heading');
  if (label) label.textContent = side === 'sell' ? 'Tokens to sell' : `${paired ? quoteSymbol : 'SOL'} to spend`;
  const asset = document.querySelector('#trade-asset-symbol');
  if (asset) {
    if (side === 'sell') asset.textContent = coinTradeEstimate?.symbol || document.querySelector('#coin-symbol')?.textContent?.trim() || 'Token';
    else if (paired) asset.textContent = quoteSymbol;
    else asset.innerHTML = '<img src="/solana-logomark.svg" alt="" aria-hidden="true" /> SOL';
  }
  const amount = document.querySelector('#trade-amount');
  if (amount) amount.placeholder = side === 'sell' ? '1,000' : '0.10';
  const presets = document.querySelector('#coin-quick-amounts');
  if (presets) presets.hidden = side === 'sell' || paired;
  const sellPresets = document.querySelector('#coin-sell-percentages');
  if (sellPresets) sellPresets.hidden = side !== 'sell';
  document.querySelectorAll('[data-coin-trade-side]').forEach(button => {
    const active = button.dataset.coinTradeSide === side;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const submit = document.querySelector('#trade-submit');
  if (submit) submit.textContent = side === 'sell' ? 'Sell in wallet' : 'Buy in wallet';
  renderTradeBalances();
  renderTradeAmountEstimate();
}
