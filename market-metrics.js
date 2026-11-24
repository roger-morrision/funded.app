// Missing measurements must not become zero or a different kind of metric.
export function metricNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function completeTradeCount(buys, sells) {
  return [buys, sells].every(value => Number.isSafeInteger(value) && value >= 0)
    && Number.isSafeInteger(buys + sells) ? buys + sells : null;
}
export function marketValuation(data) {
  const cap = metricNumber(data?.marketCapUsd), fdv = metricNumber(data?.fdvUsd);
  return cap != null && cap >= 0 ? {value:cap,label:'Market cap'}
    : fdv != null && fdv >= 0 ? {value:fdv,label:'FDV'} : {value:null,label:'Market cap'};
}
