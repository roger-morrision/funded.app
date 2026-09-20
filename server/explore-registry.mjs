// Apply ordering before pagination; the Devnet registry is not an ordered index.
export function sortDevnetLaunches(items, sort = 'last_trade_timestamp') {
  const time = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  return [...items].sort((a, b) => sort === 'created_timestamp'
    ? time(b.createdTimestamp) - time(a.createdTimestamp)
    : sort === 'last_trade_timestamp'
      ? time(b.lastTradeTimestamp || b.createdTimestamp) - time(a.lastTradeTimestamp || a.createdTimestamp)
      : time(b.marketCapUsd) - time(a.marketCapUsd));
}
