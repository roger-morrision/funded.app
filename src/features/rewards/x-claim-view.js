import { summarizeXClaims, formatXClaimSol } from '../../../x-claim-summary.js';

// The application owns wallet state and event wiring. Dependencies are supplied per call.
export function syncXClaimFlow({
  captureWalletSession,
  document = globalThis.document,
}) {
  const xConnected=document.querySelector('#x-sign-in')?.dataset.connected==='true';
  const claimId=String(document.querySelector('#sol-claim-id')?.value||'').trim();
  const address=captureWalletSession()?.address||'';
  const agreed=Boolean(document.querySelector('#claim-binding-agree')?.checked);
  const readyCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.ready').length;
  const paidCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.paid').length;
  const button=document.querySelector('#sol-claim-submit');
  const review=document.querySelector('#selected-claim-review');
  const walletReview=document.querySelector('#claim-binding-review');
  if(review){
    review.hidden=!xConnected||!claimId;
    const row=[...document.querySelectorAll('#sol-claim-list [data-claim-id]')].find(item=>item.dataset.claimId===claimId);
    const summary=document.querySelector('#selected-claim-summary');
    if(summary)summary.textContent=row?.dataset.claimSummary||`Claim ${claimId}`;
  }
  if(walletReview)walletReview.hidden=!xConnected||!claimId;
  if(button){
    button.hidden=!xConnected||!claimId;
    button.disabled=!xConnected||!claimId||Boolean(address&&!agreed)||button.dataset.processing==='true';
    button.textContent=!xConnected?'Sign in with X first':!claimId?(readyCount?'Choose a reward to continue':'No rewards ready to claim'):!address?'Connect wallet to continue':!agreed?'Confirm wallet above':'Verify wallet and claim SOL';
  }
  const paidOnly=xConnected&&paidCount>0&&readyCount===0&&!claimId;
  const stepState={x:xConnected,choose:xConnected&&(Boolean(claimId)||paidOnly),wallet:xConnected&&((Boolean(claimId)&&Boolean(address&&agreed))||paidOnly),paid:paidOnly};
  let foundCurrent=false;
  for(const step of document.querySelectorAll('#x-claim-steps [data-claim-step]')){
    const done=stepState[step.dataset.claimStep]===true;
    const current=!done&&!foundCurrent;
    step.classList.toggle('complete',done);
    step.classList.toggle('current',current);
    if(current){step.setAttribute('aria-current','step');foundCurrent=true;}else step.removeAttribute('aria-current');
  }
}

export function updateClaimBindingReview({
  captureWalletSession,
  syncXClaimFlow,
  document = globalThis.document,
}) {
  const node=document.querySelector('#claim-binding-review');
  if(!node)return;
  const address=captureWalletSession()?.address||'';
  const check=document.querySelector('#claim-binding-agree');
  if(check?.dataset.wallet!==address){check.checked=false;check.dataset.wallet=address;}
  if(check)check.disabled=!address;
  const destination=document.querySelector('#claim-binding-wallet');
  if(destination)destination.textContent=address?`Solana · ${address}`:'Connect the wallet that should receive this claim.';
  syncXClaimFlow();
}

export function renderXClaimSummary(claims, {
  document = globalThis.document,
  window = globalThis.window,
}) {
  const summary=summarizeXClaims(claims);
  window.dispatchEvent(new Event('funded:reward-identity-change'));
  const labels={total:n=>`${n} collected reward${n===1?'':'s'}`,claimed:n=>`${n} verified payment${n===1?'':'s'}`,unclaimed:n=>`${n} available reward${n===1?'':'s'}`,pending:n=>`${n} claim${n===1?'':'s'} in progress`};
  for(const key of Object.keys(labels)){
    const value=document.querySelector(`#x-claim-${key}-value`);
    const count=document.querySelector(`#x-claim-${key}-count`);
    if(value)value.textContent=summary?formatXClaimSol(summary[key]):'—';
    if(count)count.textContent=summary?labels[key](summary[key].count):'Sign in to view';
  }
  const note=document.querySelector('#x-claim-dashboard-note');
  if(note)note.textContent=summary&&Object.values(summary).some(bucket=>!bucket.complete)?'Some amounts are unavailable. Paid totals include confirmed payments only.':'Paid totals include confirmed SOL payments.';
}

export function resetSolClaimStatus({
  captureWalletSession,
  syncXClaimFlow,
  document = globalThis.document,
}) {
  const status = document.querySelector('#sol-claim-status');
  if(status){
    const connected=document.querySelector('#x-sign-in')?.dataset.connected==='true';
    const chosen=Boolean(document.querySelector('#sol-claim-id')?.value?.trim());
    const address=captureWalletSession()?.address;
    const agreed=document.querySelector('#claim-binding-agree')?.checked;
    const readyCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.ready').length;
    const paidCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.paid').length;
    status.textContent=!connected?'Sign in with X to see your rewards.':!chosen?(readyCount?'Choose an available reward above.':paidCount?'Your listed reward has been paid. No other rewards are ready to claim.':'No rewards are ready to claim yet. Check back after creator fees are collected.'):!address?'Connect the wallet that should receive this payment.':!agreed?'Confirm the receiving wallet above.':'Ready to verify. Phantom will ask you to approve a message; signing does not spend SOL.';
  }
  syncXClaimFlow();
}
