import {tokenAge} from '../../../token-list-market-state.js';
import {withMarketWindow} from '../../../market-intelligence.js';
import {escapeHtml} from '../shared/display.js';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const recent = (at,now) => Number.isFinite(at) && now >= at && now-at < 300_000;
export function featuredMetrics(item, {asset={},holderSnapshot,solUsd,cluster='devnet',now=Date.now()} = {}) {
  const fresh=recent(Date.parse(asset.verifiedAt),now), rate=number(solUsd);
  const cap=number(cluster==='devnet' ? asset.migrated===true ? asset.poolMarketCapSol : asset.complete===false ? asset.curveCapSol : null : asset.marketCapUsd);
  const usd=cap!=null&&cap>=0&&fresh ? cluster==='devnet' ? rate>0?cap*rate:null : cap : null;
  const market=withMarketWindow(asset,'24h');
  const indexed=cluster!=='devnet';
  const change=fresh&&recent(asset.marketActivityObservedAt,now)?number(market.windowPriceChangePercent):indexed?number(asset.priceChange24hPercent):null;
  const count=recent(holderSnapshot?.at,now)?number(holderSnapshot.count):indexed&&Number.isSafeInteger(asset.holderCount)?asset.holderCount:null;
  const age=tokenAge(item.createdAt||(indexed&&number(asset.pairCreatedAt)>0?number(asset.pairCreatedAt):null),now);
  return {cap:usd==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(usd),
    change:change==null?'—':`≈${change>0?'+':''}${change.toFixed(2)}%`,direction:change==null?'unknown':change<0?'negative':'positive',
    age:age.timestamp?age.label:'—',ageAt:age.timestamp,
    holders:count!=null&&Number.isSafeInteger(count)&&count>=0?`${holderSnapshot.coverage==='lower-bound'?'≥':''}${count.toLocaleString('en-US')}`:'—',
    holderTitle:count==null?'Verified holder count unavailable':holderSnapshot.coverage==='lower-bound'?'At least this many distinct wallet owners in the confirmed token-account sample':'Distinct wallet owners in confirmed non-vault token accounts'};
}

export function featuredMetricsMarkup(metrics=featuredMetrics({})) {
  const e=escapeHtml;
  return `<div><dt>MC</dt><dd class="featured-mc">${e(metrics.cap)}</dd></div>
    <div title="Estimated 24-hour market-cap change at current supply and SOL/USD rate, based on verified token price change. Unavailable without a full-period baseline."><dt>MC Δ 24h</dt><dd data-direction="${e(metrics.direction)}">${e(metrics.change)}</dd></div>`;
}

export function featuredBannerMetricsMarkup(metrics=featuredMetrics({})) {
  const e=escapeHtml;
  return `<div title="${e(metrics.ageAt?'Confirmed launch time: '+metrics.ageAt:'Verified launch time unavailable')}" ><dt>Age</dt><dd>${e(metrics.age)}</dd></div>
    <div title="${e(metrics.holderTitle)}"><dt>Holders</dt><dd class="featured-holders">${e(metrics.holders)}</dd></div>${featuredMetricsMarkup(metrics)}`;
}
