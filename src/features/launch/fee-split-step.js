// Move the original controls so listeners, draft values and signed-policy IDs stay intact.
export function mountStepOneFeeSplit(document=globalThis.document){
  const first=document.querySelector('[data-launch-step="1"]');
  const fees=document.querySelector('.launch-fee-options'),policy=document.querySelector('#custom-policy');
  if(!first||!fees||!policy)return;
  const modes=fees.querySelector('.launch-mode-grid'),fields=policy.querySelector('.form-grid');
  if(modes&&fields)fields.before(modes);
  first.append(policy);policy.hidden=false;policy.classList.add('launch-fee-editor');
  const feeTitle=fees.querySelector('h3');
  if(feeTitle){feeTitle.firstChild.textContent='Fee distribution ';const note=feeTitle.querySelector('span');if(note)note.textContent='Your step 1 split is shown in the launch summary';}
  first.querySelector(':scope > .step-heading p').textContent='Add your token details and choose how your 80% creator-fee share is split.';
  const firstTab=document.querySelector('[data-launch-step-target="1"]');
  firstTab.querySelector('span').textContent='Token & fees';firstTab.setAttribute('aria-label','Step 1: Token details and fee split');
  document.querySelector('#benefits-step-title').textContent='Funding & launch';
  document.querySelector('[data-launch-step="2"] > .step-heading p').textContent='Choose the community allocation, optional developer buy and promotion. Review your fee split and costs before signing.';
}
