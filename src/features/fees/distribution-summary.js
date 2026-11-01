import { FEE_DISTRIBUTION } from '../../../distribution-policy.js';
import { MARKETING_AGENCY_POLICY } from '../../../config/marketing-agency.js';
import { escapeHtml } from '../shared/display.js';
import { feeBenefitDetailsMarkup } from './benefit-details.js';

export const FEE_PERCENT_BASIS = 'Percentages of collected creator fees, not trade volume. Trading, launch and optional promotion charges, plus network costs, are separate.';
export const FEE_POLICY_SCOPE = 'New launches use the published policy. Existing coins keep their saved rates. Allocations become payouts or burns only after funding and finalized receipts.';

export function approvedFeePresentation() {
  const policy=MARKETING_AGENCY_POLICY,percent=units=>units*100/policy.grossUnits;
  return {creatorPercent:percent(policy.creatorUnits),operationsEffectivePercent:percent(policy.operationsUnits),
    appReferralEffectivePercent:percent(policy.referralUnits.reduce((sum,n)=>sum+n,0)),communityEffectivePercent:percent(policy.communityUnits),
    buybackEffectivePercent:percent(policy.fundedBuybackUnits),agencyEffectivePercent:percent(policy.agencyUnits)};
}

export function feeDistributionPresentation(fee=FEE_DISTRIBUTION) {
  const rows=[
    ['creator',fee.creatorPercent,'Creator-directed','Keep your share or distribute it to eligible coin holders and a named X account.'],
    ['operations',fee.operationsEffectivePercent,'Operations & marketing','The app allocation funds platform operations and marketing.'],
    ['referrals',fee.appReferralEffectivePercent,'Referral network','Reward qualified creator referrals across the saved three-level network.'],
    ['community',fee.communityEffectivePercent,'Daily bonus','Top traders, creators and referrers share this pool: top 3 per category, with equal category budgets.'],
    ['buyback',fee.buybackEffectivePercent,'$FUNDED buyback & burn','Funds automatic purchases and burns of $FUNDED when funding and execution conditions are met.'],
    ...(fee.agencyEffectivePercent===undefined?[]:[['agency',fee.agencyEffectivePercent,'AI marketing & coin buybacks','Funds selected agents, including automatic buyback and burn of the launched coin at its saved milestones. Unused budgets stay reserved.']]),
  ].map(([key,percent,label,benefit])=>({key,percent,label,benefit}));
  const total=rows.reduce((sum,row)=>sum+row.percent,0);
  if(rows.some(row=>!Number.isFinite(row.percent)||row.percent<0)||Math.abs(total-100)>0.000001)throw Error('Fee presentation must account for 100% of collected creator fees.');
  const operations=fee.operationsEffectivePercent,benefits=Number((100-operations).toFixed(6)),ecosystem=Number((100-fee.creatorPercent-operations).toFixed(6));
  return {rows,total,operations,benefits,ecosystem,headline:`Only ${operations}% for Operations & marketing`,
    benefitLine:`${benefits}% is allocated to creators, referrals, Daily bonuses and token buybacks.`,
    allocation:rows.map(row=>`${row.percent}% ${row.label}`).join(' · ')+'.'};
}

export function feeDistributionMarkup({fee,scope=FEE_POLICY_SCOPE,titleLevel=2,compact=false}={}) {
  const model=feeDistributionPresentation(fee),heading=titleLevel===3?'h3':'h2';
  const rules=`<p class="fee-distribution-basis"><b>100% accounted for.</b> ${FEE_PERCENT_BASIS}</p><p class="fee-distribution-scope">${escapeHtml(scope)}</p>`;
  const disclosure=`<details class="fee-distribution-details"><summary>Benefits &amp; policy details</summary>${feeBenefitDetailsMarkup(model.rows)}${compact?rules:''}</details>`;
  const detail=compact?`<p class="fee-distribution-caption">Shares of collected creator fees. Payouts and burns require funding and finalized receipts.</p>${disclosure}`:`${disclosure}${rules}`;
  return `<div class="fee-distribution-summary${compact?' fee-distribution-summary--compact':''}"><header><p class="eyebrow">Collected creator-fee distribution</p><${heading}>${escapeHtml(model.headline)}</${heading}><p>${escapeHtml(model.benefitLine)}</p></header><div class="fee-distribution-categories">${model.rows.map(row=>`<article data-fee-category="${row.key}"><strong>${row.percent}%</strong><span>${escapeHtml(row.label)}</span>${compact?'':`<small>${escapeHtml(row.benefit)}</small>`}</article>`).join('')}</div>${detail}</div>`;
}

const renderedSummaries=new WeakMap();
export function renderFeeDistributionSummaries(document=globalThis.document) {
  for(const root of document?.querySelectorAll('[data-fee-distribution]')||[]){
    const markup=feeDistributionMarkup({titleLevel:root.dataset.feeDistribution==='launch'?3:2,compact:true});
    if(renderedSummaries.get(root)!==markup){root.innerHTML=markup;renderedSummaries.set(root,markup);}
  }
  const model=feeDistributionPresentation();
  for(const root of document?.querySelectorAll('[data-fee-fixed-list]')||[]){
    const markup=model.rows.filter(row=>row.key!=='creator').map(row=>`<div data-fixed-fee-category="${row.key}"><dt>${escapeHtml(row.label)}</dt><dd>${row.percent}%</dd></div>`).join('');
    if(renderedSummaries.get(root)!==markup){root.innerHTML=markup;renderedSummaries.set(root,markup);}
  }
  for(const[selector,value]of[['[data-app-allocation]',model.operations],['[data-ecosystem-allocation]',model.ecosystem]])for(const root of document?.querySelectorAll(selector)||[])root.textContent=`${value}%`;
  for(const root of document?.querySelectorAll('[data-fee-group-bar]')||[]){
    const groups={creator:[model.rows[0].percent,'#a8d9bf'],operations:[model.operations,'#ffc46b'],ecosystem:[model.ecosystem,'#8ba8ee']};
    const value=groups[root.dataset.feeGroupBar];if(value){root.style.width=`${value[0]}%`;root.style.background=value[1];}
  }
}
