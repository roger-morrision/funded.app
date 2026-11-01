import { el } from './view-utils.js';

export function initializeLaunchTerms() {
  const form=document.querySelector('#launch-form'),submit=document.querySelector('#launch-button');
  if(!form||!submit)return;
  const terms=el('details',null,'flow-panel');terms.id='launch-final-terms';
  terms.append(el('summary','Final launch terms and payout timing'));
  const body=el('p');terms.append(body);submit.before(terms);
  function review(){
    const value=id=>document.getElementById(id)?.value||'0';
    body.textContent=`Review before signing: ${value('token-name')} ($${value('token-symbol')}). Creator ${value('creator-wallet-share')}%, holders ${value('holder-airdrop-share')}%, X ${value('x-share')}%, protocol 20%. Mint identity and signed fee terms are fixed at launch. Holder cutoffs, ranked daily bonus windows, funding and recipient eligibility still apply. A cutoff does not promise immediate payment. Current costs appear in the budget and wallet review.`;
  }
  form.addEventListener('input',review);window.addEventListener('funded:launch-step',review);review();
}
