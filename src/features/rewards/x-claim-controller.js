import { normalizeXHandle } from '../../../sol-claim-policy.js';
import bs58 from 'bs58';
import { confirmedClaimResult } from '../../../reward-discovery.js';

// The application owns wallet state and event wiring. Dependencies are supplied per call.
export async function submitSolClaim({
  connectWallet,
  captureWalletSession,
  updateClaimBindingReview,
  assertWalletSessionCurrent,
  isWalletSessionCurrent,
  refreshXClaims,
  showToast,
  syncXClaimFlow,
  getWallet,
  emitPilotSignal,
  apiRequest,
  pilotInterruptedSignal,
  document = globalThis.document,
}) {
  const status = document.querySelector('#sol-claim-status');
  const handle = normalizeXHandle(document.querySelector('#sol-claim-x-account')?.value);
  const claimId = String(document.querySelector('#sol-claim-id')?.value || '').trim();
  if (!handle || !claimId) { if (status) status.textContent = 'Sign in with X and choose one of your available claims first.'; return; }
  if (!getWallet()) { await connectWallet(); if (!getWallet()) return; }
  const session = captureWalletSession();
  if (!session || session.provider.readOnly || typeof session.provider.signMessage !== 'function') { if (status) status.textContent = 'This wallet cannot sign claim messages here.'; return; }
  updateClaimBindingReview();
  if(!document.querySelector('#claim-binding-agree')?.checked){if(status)status.textContent='Review and confirm the destination wallet before binding this claim.';return;}
  const button = document.querySelector('#sol-claim-submit'); if (button){button.disabled=true;button.dataset.processing='true';}
  let claimExecutionRequested = false, claimVerified = false;
  emitPilotSignal('claim-started');
  try {
    const identity = await apiRequest('/api/x/me');
    assertWalletSessionCurrent(session);
    if (!identity.data?.authenticated || `@${identity.data.user.username}`.toLowerCase() !== handle.toLowerCase()) throw new Error('Sign in with the X account named in this claim first.');
    if (status) status.textContent = 'Preparing claim…';
    const prepared = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/prepare`, { method: 'POST', body: { xHandle: handle } });
    assertWalletSessionCurrent(session);
    if(!prepared.available||!prepared.data?.statement)throw new Error('Claim preparation unavailable. No wallet signature requested.');
    if(prepared.data.boundWallet&&prepared.data.boundWallet!==session.address)throw new Error(`This claim is already bound to ${prepared.data.boundWallet}. Connect that wallet; redirection is not supported.`);
    if (status) status.textContent = 'Verifying X identity…';
    await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/attest`, { method: 'POST', body: { xHandle: handle } });
    assertWalletSessionCurrent(session);
    if (status) status.textContent = 'Requesting wallet signature…';
    const message = new TextEncoder().encode(prepared.data.statement);
    const signed = await session.provider.signMessage(message);
    assertWalletSessionCurrent(session);
    const publicKey = session.address;
    const verified = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/verify`, { method: 'POST', body: { xHandle: handle, publicKey, signature: bs58.encode(signed.signature || signed) } });
    if (!isWalletSessionCurrent(session)) return { verified };
    if (verified.data?.automaticStatus) {
      const claims = await refreshXClaims();
      if (!isWalletSessionCurrent(session)) return { verified };
      const paidClaim = claims?.find(claim => claim.id === claimId && claim.receiptVerified === true && claim.payoutWallet === publicKey);
      claimVerified = Boolean(paidClaim);
      emitPilotSignal(claimVerified ? 'claim-verified' : 'claim-pending');
      if (status) status.textContent = claimVerified
        ? `Verified payment of ${paidClaim.amountSol} SOL to ${publicKey}. Transaction: ${paidClaim.payoutSignature}`
        : 'Wallet verified. Automatic SOL delivery is in progress; check this reward for its payment receipt.';
      return { verified };
    }
    if (status) status.textContent = 'Settling the mint-specific claim on Devnet…';
    claimExecutionRequested = true;
    const paid = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/execute`, { method: 'POST' });
    if (!isWalletSessionCurrent(session)) return { verified, paid };
    if(!paid.available||!paid.data?.signature)throw new Error('Payout outcome is uncertain. Refresh rewards; do not submit another payout.');
    const checked=await apiRequest('/api/x-fee/claims').catch(()=>null);
    if(!isWalletSessionCurrent(session))return {verified,paid};
    const confirmed=confirmedClaimResult(checked?.data?.claims,claimId,paid.data.signature);
    claimVerified = Boolean(confirmed);
    emitPilotSignal(claimVerified ? 'claim-verified' : 'claim-pending');
    if (status) status.textContent = confirmed?`Verified payment of ${confirmed.amountSol} SOL to ${publicKey}. Transaction: ${confirmed.payoutSignature}`:'Settlement response received. Payment verification is pending; refresh rewards later. Do not submit another payout.';
    showToast(confirmed?'Payment receipt verified':'Payment verification pending');
    await refreshXClaims();
    return { verified, paid };
  } catch (error) { if (!claimVerified) emitPilotSignal(pilotInterruptedSignal('claim', error, claimExecutionRequested)); if (isWalletSessionCurrent(session)) { if (status) status.textContent = error.message || 'Claim failed.'; showToast(error.message || 'Claim failed'); } }
  finally { if (button) delete button.dataset.processing; syncXClaimFlow(); }
}

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
    if (!result.data.claims.length) { clearSelection();list.textContent = 'No collected creator fees are ready for this X account yet. Check back later.'; syncXClaimFlow(); return; }
    const selectedId=String(document.querySelector('#sol-claim-id')?.value||'').trim();
    if(selectedId&&!result.data.claims.some(claim=>claim.id===selectedId&&claim.canPrepare===true)){
      clearSelection();
    }
    const claimsByAction = [...result.data.claims].sort((a, b) =>
      Number(b.canPrepare === true) - Number(a.canPrepare === true)
      || Number(a.receiptVerified === true) - Number(b.receiptVerified === true));
    for (const claim of claimsByAction) {
      const row=document.createElement('div');row.className=`x-claim-reward${claim.receiptVerified?' x-claim-reward-paid':''}`;row.dataset.claimId=claim.id;
      if(claim.id===selectedId&&claim.canPrepare===true)row.classList.add('selected');
      const state=document.createElement('span');state.className=`x-claim-reward-state ${claim.receiptVerified?'paid':claim.canPrepare?'ready':'pending'}`;state.textContent=claim.receiptVerified?'Paid':claim.canPrepare?'Ready to claim':String(claim.status).startsWith('automatic-')?'Processing payout':'Not ready yet';
      const copy=document.createElement('div');copy.className='x-claim-reward-copy';
      const launch=verifiedLaunchPolicyForMint(claim.mint);
      const coinLabel=launch?[launch.symbol,launch.name].filter(Boolean).join(' · '):`Coin ${String(claim.mint||'').slice(0,6)}…`;
      const coin=document.createElement('a');coin.className='x-claim-coin';coin.href=`/token/${encodeURIComponent(claim.mint)}`;coin.textContent=coinLabel;
      const amount=document.createElement('strong');amount.textContent=claim.amountSol==null?'Amount unavailable':`${claim.amountSol} SOL`;
      const context=document.createElement('small');context.textContent=claim.receiptVerified?`To ${claim.payoutWallet||'verified wallet'}`:claim.canPrepare?'Collected creator fees · ready for your wallet verification':claim.explanation||'Waiting for collected fees';
      if(claim.receiptVerified&&claim.payoutWallet)context.title=claim.payoutWallet;
      copy.append(coin,amount,context);row.append(state,copy);
      row.dataset.claimSummary=`${amount.textContent} from ${coinLabel}`;
      if (claim.canPrepare === true) {
        const choose = document.createElement('button');
        choose.type = 'button'; choose.className = 'secondary-button'; choose.textContent = 'Select reward';
        choose.addEventListener('click', () => { document.querySelector('#sol-claim-id').value=claim.id;document.querySelector('#sol-claim-x-account').value=result.data.handle;document.querySelectorAll('#sol-claim-list .x-claim-reward').forEach(item=>item.classList.toggle('selected',item===row));const check=document.querySelector('#claim-binding-agree');if(check)check.checked=false;updateClaimBindingReview();resetSolClaimStatus(); });
        row.append(choose);
      }
      if(claim.receiptVerified&&claim.payoutSignature){const receipt=document.createElement('a');receipt.className='payment-receipt-link';receipt.href=`https://explorer.solana.com/tx/${encodeURIComponent(claim.payoutSignature)}?cluster=devnet`;receipt.textContent='↗';receipt.setAttribute('aria-label','View X reward payment on Solana Explorer');receipt.title='View payment on Solana Explorer';receipt.target='_blank';receipt.rel='noopener noreferrer';row.append(receipt);}
      list.append(row);
    }
    syncXClaimFlow();
    return result.data.claims;
  } catch (error) { clearSelection();list.textContent = error.message || 'Rewards are temporarily unavailable.';renderXClaimSummary(null); syncXClaimFlow(); }
}
