

// Move the original controls so listeners, form values and signed-policy IDs stay intact.
export function mountStepOneFeeSplit(document=globalThis.document){
  const first=document.querySelector('[data-launch-step="1"]');
  const options=document.querySelector('[data-launch-step="2"]');
  const policy=document.querySelector('#custom-policy');
  if(!first||!options||!policy)return;
  options.querySelector('.step-heading').after(policy);policy.hidden=false;policy.classList.add('launch-fee-editor');
  first.querySelector(':scope > .step-heading p').textContent='Add a name and ticker. An image, description and project links are optional.';
  const firstTab=document.querySelector('[data-launch-step-target="1"]');
  firstTab.querySelector('span').textContent='Details';firstTab.setAttribute('aria-label','Step 1: Details');
  const secondTab=document.querySelector('[data-launch-step-target="2"]');
  secondTab.querySelector('span').textContent='Rewards & funding';secondTab.setAttribute('aria-label','Step 2: Rewards and funding');
  document.querySelector('#benefits-step-title').textContent='Rewards & funding';
  options.querySelector(':scope > .step-heading p').textContent='Choose who receives your creator-fee allocation, then check the launch funding. Promotion is optional.';
  const overview=document.querySelector('.launch-fixed-distribution');
  if(overview&&!document.querySelector('#launch-fee-overview')){
    const details=document.createElement('details');details.id='launch-fee-overview';details.className='ui-disclosure launch-fee-overview';
    const summary=document.createElement('summary');summary.textContent='Fee breakdown';
    overview.before(details);details.append(summary,overview);
  }
}
