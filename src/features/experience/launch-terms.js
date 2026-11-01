import { el } from './view-utils.js';

export function initializeLaunchTerms() {
  const form=document.querySelector('#launch-form'),submit=document.querySelector('#launch-button');
  if(!form||!submit||document.querySelector('#launch-final-terms'))return;
  const terms=el('details',null,'ui-disclosure launch-final-terms');terms.id='launch-final-terms';
  terms.append(el('summary','Before you sign'));
  const body=el('div',null,'launch-final-terms-body'),identity=el('p',null,'launch-final-identity'),list=el('ul',null,'launch-final-checklist');
  for(const[title,description]of[
    ['Launch policy','Token identity and the fee split are fixed at launch.'],
    ['Reward timing','Holder cutoffs and ranked daily bonus windows apply. Funding and recipient eligibility are checked before payout.'],
    ['Wallet review','Review the cost breakdown and each wallet request before signing.'],
  ]){const item=el('li');item.append(el('strong',title),el('span',description));list.append(item);}
  body.append(identity,list);terms.append(body);submit.before(terms);
  function review(){
    const value=id=>document.getElementById(id)?.value.trim()||'';
    identity.textContent=`${value('token-name')||'Token name'} ($${value('token-symbol').toUpperCase()||'TICKER'})`;
  }
  form.addEventListener('input',review);window.addEventListener('funded:launch-step',review);review();
}
