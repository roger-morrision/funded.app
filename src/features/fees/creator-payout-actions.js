export function creatorPayoutActions(row) {
  const plan=row.allocationPlan;
  if(row.settlement!=='finalized'||plan?.status!=='allocated-not-funded')return [];
  const amount=value=>/^(0|[1-9]\d*)$/.test(String(value))?BigInt(value):0n;
  const actions=[['community-funding','communityFunding',plan.protocol?.communityLamports,'Fund community allocation'],
    ['creator-reward-funding','creatorRewardFunding',String(amount(plan.creatorDirected?.holderLamports)+amount(plan.creatorDirected?.xLamports)),'Fund holder and X rewards'],
    ['creator-wallet-payout','creatorWalletPayout',plan.creatorDirected?.walletLamports,'Receive creator allocation'],
    ['operations-payout','operationsPayout',plan.protocol?.operationsLamports,'Pay operations allocation']];
  for(let i=0;i<3;i++)actions.push([`referral-payout/${i+1}`,'referralPayout',
    plan.protocol?.referralLamports?.[i],`Pay referral level ${i+1}`]);
  return actions.map(([action,gate,amount,label])=>({action,gate,amount,label,
    finalized:action.startsWith('referral-payout/')?row.referralPayouts?.[Number(action.split('/')[1])-1]==='finalized':row[gate]==='finalized'}));
}
export function creatorActionPath(mint,source,action) {
  const [name,level]=action.split('/');
  return `/api/tokens/${encodeURIComponent(mint)}/v3-${name}/${encodeURIComponent(source)}${level?`/${level}`:''}`;
}

export async function approveCreatorPayoutBatch(appState,button,actions) {
  const mint=appState.getCoinMintAddress(),session=appState.captureWalletSession();
  if(!session||session.address!==appState.currentCoinFeeOverview?.creatorWallet||appState.creatorClaimsInFlight.has(mint))return;
  if(typeof session.provider.signAllTransactions!=='function')return;
  appState.creatorClaimsInFlight.add(mint);const original=button.textContent;let submitted=0;
  try{
    button.disabled=true;button.textContent='Preparing payout reviews…';
    const {Transaction}=await appState.getSolana(),prepared=[];
    for(const action of actions.slice(0,3)){
      appState.assertWalletSessionCurrent(session);
      const path=creatorActionPath(mint,action.source,action.action);
      const result=await appState.apiRequest(path,{method:'POST',body:{}});
      appState.assertWalletSessionCurrent(session);
      const row=result.data;
      if(row?.status==='finalized')continue;
      if(!result.available||row?.status!=='awaiting-creator-signature'||row.mint!==mint
        ||row.collectionSignature!==action.source||!row.recipient||!row.transaction)
        throw new Error('Payout review is unavailable. Refresh before approving.');
      prepared.push({path,transaction:Transaction.from(appState.base64ToBytes(row.transaction))});
    }
    if(!prepared.length)return;
    button.textContent=`Review ${prepared.length} payouts in your wallet…`;
    const signed=await session.provider.signAllTransactions(prepared.map(row=>row.transaction));
    appState.assertWalletSessionCurrent(session);
    if(!Array.isArray(signed)||signed.length!==prepared.length)throw new Error('Wallet returned an incomplete approval.');
    for(let i=0;i<signed.length;i++){
      appState.assertWalletSessionCurrent(session);
      button.textContent=`Finalizing payout ${i+1} of ${signed.length}…`;
      const result=await appState.apiRequest(prepared[i].path,{method:'POST',body:{creatorSignedTransaction:
        appState.bytesToBase64(signed[i].serialize({requireAllSignatures:false,verifySignatures:false}))}});
      if(result.data?.status!=='finalized')throw new Error('A payout needs reconciliation. Refresh before signing again.');
      submitted++;
    }
    appState.showToast(`${submitted} payouts finalized on Devnet.`);
  }catch(error){appState.showToast(`${submitted} payouts finalized. ${error.message}`);}
  finally{
    appState.creatorClaimsInFlight.delete(mint);
    if(appState.isWalletSessionCurrent(session)){
      const updated=await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/fee-activity`).catch(()=>null);
      if(appState.isWalletSessionCurrent(session)&&appState.getCoinMintAddress()===mint&&updated?.available)
        appState.renderCoinFeeDashboard(updated.data.overview);
    }
    if(button.isConnected){button.disabled=false;button.textContent=original;}
  }
}
