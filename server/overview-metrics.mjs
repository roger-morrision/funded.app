import {metricNumber} from '../market-metrics.js';
export const METRICS_VERSION=2;
export function supplyFacts(value) {
  const supply=metricNumber(value);
  return {supplyTokens:supply!=null&&supply>=0?supply:null,initialSupplyTokens:null,burnedTokens:null,burnedPercent:null,burnedSupplyVerified:false};
}
export function cachedOverview(row) {
  return {...row,...supplyFacts(row.supplyTokens),
    ...(row.metricsVersion===METRICS_VERSION?{}:{marketCapUsd:null,fdvUsd:null}),stale:true};
}
export function mergeOverviewMetrics(cached,row,burn,holders) {
  return {...cached,...Object.fromEntries(Object.entries(row).filter(([,value])=>value!=null)),
    // Explicit nulls clear old or legacy-derived measurements from the cache.
    ...Object.fromEntries(['marketCapUsd','fdvUsd','buyCount24h','sellCount24h','volume24hUsd'].map(key=>[key,metricNumber(row[key])])),
    windows:row.windows??null,...supplyFacts(null),...burn,...holders,holders:holders.holderCount,metricsVersion:METRICS_VERSION};
}
