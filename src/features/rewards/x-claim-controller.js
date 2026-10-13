export async function loadXIdentity({
  renderXClaimSummary,
  syncXClaimFlow,
  refreshXClaims,
  resetSolClaimStatus,
  watchlistSync,
  restoreWalletFavorites,
  apiRequest,
  document = globalThis.document,
}) {
  const button = document.querySelector('#x-sign-in');
  const status = document.querySelector('#x-identity-status');
  if (!button || !status) return;
  try {
    const result = await apiRequest('/api/x/me');
    if (!result.available) { void restoreWalletFavorites({ force: true }).then(restored => { if (!restored) void watchlistSync.setIdentity(undefined); }); status.textContent = 'X sign-in is temporarily unavailable. Please try again later.'; button.disabled = true; button.dataset.connected = 'false'; renderXClaimSummary(null);syncXClaimFlow(); return; }
    if (result.data?.authenticated) {
      button.disabled = false;
      const user = result.data.user;
      void watchlistSync.setIdentity(String(user.id));
      status.textContent = `Connected as @${user.username}`;
      button.textContent = 'Sign out of X';
      button.dataset.connected = 'true';
      const handle = document.querySelector('#sol-claim-x-account');
      if (handle) handle.value = `@${user.username}`;
      await refreshXClaims();
      resetSolClaimStatus();
    } else {
      const configured = result.data?.configured === true;
      status.textContent = configured ? 'Sign in to see rewards linked to your X account.' : 'X sign-in is temporarily unavailable.';
      button.textContent = 'Sign in with X';
      button.dataset.connected = 'false';
      void restoreWalletFavorites({ force: true }).then(restored => { if (!restored) void watchlistSync.setIdentity(null); });
      button.disabled = !configured;
      const claimId=document.querySelector('#sol-claim-id');if(claimId)claimId.value='';
      const check=document.querySelector('#claim-binding-agree');if(check)check.checked=false;
      document.querySelector('#sol-claim-list')?.replaceChildren();
      const list=document.querySelector('#sol-claim-list');if(list)list.textContent='Sign in with X to see your rewards.';
      renderXClaimSummary(null);
      resetSolClaimStatus();
    }
  } catch (error) { void restoreWalletFavorites({ force: true }).then(restored => { if (!restored) void watchlistSync.setIdentity(undefined); }); status.textContent = error.message || 'X identity status is unavailable.'; renderXClaimSummary(null);syncXClaimFlow(); }
}

export async function refreshXClaims({
  renderXClaimSummary,
  syncXClaimFlow,
  verifiedLaunchPolicyForMint,
  updateClaimBindingReview,
  resetSolClaimStatus,
  apiRequest,
  document = globalThis.document,
}) {
  const list = document.querySelector('#sol-claim-list');
  if (!list) return;
  list.replaceChildren();
  const clearSelection=()=>{const id=document.querySelector('#sol-claim-id');if(id)id.value='';const check=document.querySelector('#claim-binding-agree');if(check)check.checked=false;};
  try {
    const result = await apiRequest('/api/x-fee/claims');
    if (!result.available) { clearSelection();list.textContent='Rewards are temporarily unavailable. Try again later.';renderXClaimSummary(null); syncXClaimFlow(); return; }
    renderXClaimSummary(result.data.claims);
    if (!result.data.claims.length) { clearSelection();list.textContent = 'No funded X rewards are available for this account.'; syncXClaimFlow(); return; }
    clearSelection();
    const claimsByAction = [...result.data.claims].sort((a, b) =>
      Number(a.receiptVerified === true) - Number(b.receiptVerified === true));
    for (const claim of claimsByAction) {
      const row=document.createElement('div');row.className=`x-claim-reward${claim.receiptVerified?' x-claim-reward-paid':''}`;row.dataset.claimId=claim.id;row.dataset.mint=claim.mint;
      row.dataset.claimStatus=claim.status;
      const isV3=claim.scope==='per-mint-v3';
      row.dataset.claimScope=isV3?'per-mint-v3':'historical-v2';
      const state=document.createElement('span');state.className=`x-claim-reward-state ${claim.receiptVerified?'paid':isV3&&claim.canPrepare?'ready':'pending'}`;
      state.textContent=claim.receiptVerified?'Paid':isV3?'Verify to claim':'V2 claim retired';
      const copy=document.createElement('div');copy.className='x-claim-reward-copy';
      const launch=verifiedLaunchPolicyForMint(claim.mint);
      const coinLabel=launch?[launch.symbol,launch.name].filter(Boolean).join(' · '):`Coin ${String(claim.mint||'').slice(0,6)}…`;
      const coin=document.createElement('a');coin.className='x-claim-coin';coin.href=`/token/${encodeURIComponent(claim.mint)}`;coin.textContent=coinLabel;
      const amount=document.createElement('strong');amount.textContent=claim.amountSol==null?'Amount unavailable':`${claim.amountSol} SOL`;
      const context=document.createElement('small');context.textContent=claim.receiptVerified?`To ${claim.payoutWallet||'verified wallet'}`:isV3?'Finalized funding recorded. Wallet and on-chain proof required.':'Historical record only.';
      if(claim.receiptVerified&&claim.payoutWallet)context.title=claim.payoutWallet;
      copy.append(coin,amount,context);
      if (claim.receiptVerified) {
        const paidTime=document.createElement('time');paidTime.className='x-claim-paid-time';
        const paidDate=claim.paidAt?new Date(claim.paidAt):null;
        if (paidDate && Number.isFinite(paidDate.getTime())) {
          paidTime.dateTime=paidDate.toISOString();
          paidTime.textContent=`Paid ${paidDate.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})}`;
        } else paidTime.textContent='Paid time unavailable';
        copy.append(paidTime);
      }
      row.append(state,copy);
      row.dataset.claimSummary=`${amount.textContent} from ${coinLabel}`;
      if(isV3&&claim.canPrepare){
        const select=document.createElement('button');select.type='button';select.textContent='Select reward';
        select.addEventListener('click',()=>{
          const id=document.querySelector('#sol-claim-id');if(id)id.value=claim.id;
          updateClaimBindingReview();resetSolClaimStatus();
        });row.append(select);
      }
      if(claim.receiptVerified&&claim.payoutSignature){const receipt=document.createElement('a');receipt.className='payment-receipt-link';receipt.href=`https://explorer.solana.com/tx/${encodeURIComponent(claim.payoutSignature)}?cluster=devnet`;receipt.textContent='↗';receipt.setAttribute('aria-label','View X reward payment on Solana Explorer');receipt.title='View payment on Solana Explorer';receipt.target='_blank';receipt.rel='noopener noreferrer';row.append(receipt);}
      list.append(row);
    }
    syncXClaimFlow();
    return result.data.claims;
  } catch (error) { clearSelection();list.textContent = error.message || 'Rewards are temporarily unavailable.';renderXClaimSummary(null); syncXClaimFlow(); }
}
