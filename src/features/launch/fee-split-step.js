import {feeDistributionPresentation} from '../fees/distribution-summary.js';

// Move the original controls so listeners, draft values and signed-policy IDs stay intact.
export function mountStepOneFeeSplit(document=globalThis.document){
  const first=document.querySelector('[data-launch-step="1"]');
  const policy=document.querySelector('#custom-policy');
  if(!first||!policy)return;
  first.append(policy);policy.hidden=false;policy.classList.add('launch-fee-editor');
  first.querySelector(':scope > .step-heading p').textContent='Add token details and split your 80% creator share.';
  const firstTab=document.querySelector('[data-launch-step-target="1"]');
  firstTab.querySelector('span').textContent='Token & fees';firstTab.setAttribute('aria-label','Step 1: Token details and fee split');
  const secondTab=document.querySelector('[data-launch-step-target="2"]');
  secondTab.querySelector('span').textContent='Launch settings';secondTab.setAttribute('aria-label','Step 2: Launch settings');
  document.querySelector('#benefits-step-title').textContent='Launch settings';
  document.querySelector('[data-launch-step="2"] > .step-heading p').textContent='Choose funding and promotion, then review your launch costs.';
  const overview=document.querySelector('.launch-fixed-distribution');
  if(overview&&!document.querySelector('#launch-fee-overview')){
    const details=document.createElement('details');details.id='launch-fee-overview';details.className='ui-disclosure launch-fee-overview';
    const summary=document.createElement('summary');summary.textContent=`Fee breakdown · ${feeDistributionPresentation().operations}% Operations & marketing`;
    overview.before(details);details.append(summary,overview);
  }
}
