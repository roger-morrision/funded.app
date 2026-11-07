import { escapeHtml } from '../shared/display.js';

// Use the coin's saved allocation, never the current defaults for new launches.
export function savedFeeDistributionRows(launch) {
  if (launch?.onchainVerified !== true) return null;
  const policy=launch.feeDistribution, shares=policy?.creatorDirected?.shares, fixed=policy?.fixedFunded;
  const directed=[['creator','Creator',shares?.creatorWalletPercent],['holders','Holders',shares?.holderAirdropPercent],['x','X account',shares?.solClaimPercent]];
  const protocol=[['operations','Operations & marketing',fixed?.operations?.effectivePercentOfCreatorFees],
    ['referrals','Referral network',fixed?.appReferral?.effectivePercentOfCreatorFees],
    ['bonus','Daily bonus',fixed?.communityRewards?.effectivePercentOfCreatorFees],
    ['buyback','$FUNDED buyback & burn',fixed?.fundedBuyback?.effectivePercentOfCreatorFees],
    ...(fixed?.marketingAgency ? [['agency','AI marketing & coin buybacks',fixed.marketingAgency.effectivePercentOfCreatorFees]] : [])];
  const rows=[...directed,...protocol];
  const sum=items=>items.reduce((total,row)=>total+row[2],0);
  if (fixed?.percent !== 20 || rows.some(([, ,percent])=>typeof percent !== 'number'||!Number.isFinite(percent)||percent<0||percent>100)
    || Math.abs(sum(directed)-80)>0.000001 || Math.abs(sum(protocol)-20)>0.000001) return null;
  return rows.map(([key,label,percent])=>({key,label,percent}));
}

export function savedFeeDistributionChart(launch) {
  const rows=savedFeeDistributionRows(launch);
  if (!rows) return '';
  const description=rows.map(row=>`${row.label}: ${row.percent}%`).join('; ');
  return `<div class="saved-fee-chart"><div class="saved-fee-bar" role="img" aria-label="${escapeHtml(description)}. Percent of collected creator fees.">${rows.filter(row=>row.percent>0).map(row=>`<span class="fee-share-${row.key}" style="width:${row.percent}%" title="${escapeHtml(row.label)}: ${row.percent}%" aria-hidden="true">${row.percent>=10?`${row.percent}%`:''}</span>`).join('')}</div><ul class="saved-fee-legend" aria-label="Fee shares">${rows.map(row=>`<li class="fee-share-${row.key}${row.percent===0?' is-zero':''}"><i aria-hidden="true"></i><span>${escapeHtml(row.label)}</span><strong>${row.percent}%</strong></li>`).join('')}</ul></div>`;
}
