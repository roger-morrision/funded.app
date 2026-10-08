import { formatTradeAmountInput } from './trade-amount-input.js';
import { formatTokenBaseAmount } from './trade-panel-balance.js';

const grouped = value => formatTradeAmountInput(value);
const sol = lamports => `${grouped(formatTokenBaseAmount(lamports, 9))} SOL`;
const tokens = (raw, decimals, symbol) => `${grouped(formatTokenBaseAmount(raw, decimals))} ${symbol}`;

export function buildTradeReview({ trade, side, amount, slippagePercent, mint, wallet, tokenName, tokenSymbol }) {
  if (!trade || !['buy', 'sell'].includes(side)) throw new Error('A prepared trade is required.');
  const fee = BigInt(trade.feeLamports || 0);
  const output = BigInt(trade.outputAmount.toString());
  const decimals = Number(trade.tokenDecimals);
  const slippageBps = Math.round(Number(slippagePercent) * 100);
  const floor = trade.minimumOutputAmount
    ? BigInt(trade.minimumOutputAmount.toString())
    : output * BigInt(10_000 - slippageBps) / 10_000n;
  const symbol = String(tokenSymbol || 'token').trim();
  const base = {
    title:`${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`,
    tokenName:String(tokenName || symbol).trim(),
    symbol, mint, wallet,
    slippage:`${slippagePercent}%`,
    fee:sol(fee),
    route:trade.route === 'graduated-pool' ? 'PumpSwap pool' : 'Pump bonding curve',
    confirmLabel:`Approve ${side === 'buy' ? 'Buy' : 'Sell'} in wallet`,
  };
  if (side === 'buy') {
    const spend = BigInt(trade.quoteAmount.toString());
    const maximumSpend = trade.maximumInputAmount
      ? BigInt(trade.maximumInputAmount.toString())
      : spend + spend * BigInt(Math.floor(Number(slippagePercent) * 10)) / 1000n;
    return {
      ...base,
      payLabel:'Estimated SOL to pay', payAmount:sol(spend + fee),
      receiveLabel:'Estimated tokens to receive', receiveAmount:tokens(output, decimals, symbol),
      limitLabel:'Maximum trade + app fee', limitAmount:sol(maximumSpend + fee),
      minimumLabel:'Minimum tokens after slippage', minimumAmount:tokens(floor, decimals, symbol),
      note:'Network and account costs are additional. Review the transaction in your wallet before signing.',
    };
  }
  const net = output - fee;
  const minimumNet = floor - fee;
  if (minimumNet <= 0n) throw new Error('The app fee exceeds the minimum SOL output.');
  return {
    ...base,
    payLabel:'Tokens to sell', payAmount:`${grouped(String(amount))} ${symbol}`,
    receiveLabel:'Estimated SOL to wallet', receiveAmount:sol(net),
    limitLabel:'Minimum SOL after slippage and app fee', limitAmount:sol(minimumNet),
    minimumLabel:'', minimumAmount:'',
    note:'The app fee is deducted from SOL received. Network costs are additional. Review the transaction in your wallet before signing.',
  };
}
