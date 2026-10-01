export function createRewardFundingProcessor({ store, chain, scheduler }) {
  async function processPending() {
    const readiness = await chain.readiness();
    if (!readiness.constrainedPayouts) return { status:'unavailable', reasons:readiness.reasons || [], pending:0, funded:0 };
    const requests = await store.transaction(state => structuredClone(Object.values(state.fundingRequests || {}).filter(row =>
      ['pending', 'funding'].includes(row.status) || row.kind === 'community-reserve' && row.status === 'verification-pending')));
    let funded = 0;
    for (const request of requests) {
      const locked = await store.transaction(state => {
        const current = state.fundingRequests?.[request.id];
        if (!current || !(['pending', 'funding'].includes(current.status)
          || current.kind === 'community-reserve' && current.status === 'verification-pending')) return false;
        current.status = 'funding'; current.startedAt = new Date().toISOString(); return true;
      });
      if (!locked) continue;
      try {
        if (request.kind === 'community-reserve') {
          if (request.asset !== 'SOL' || request.recipient) throw new Error('Community reserve requests must hold SOL without a payout recipient.');
          const funding = await chain.fundCommunitySolVaultFromMintRouter({ mint:request.mint, amount:request.amount, fundingId:request.id });
          if (funding.balanceDeltaVerified !== true || !funding.claim || !funding.vault) throw new Error('Community reserve requires a verified vault funding claim.');
          await store.transaction(state => { state.fundingRequests[request.id] = { ...state.fundingRequests[request.id],
            status:'funded', fundingSignature:funding.signature || null, fundingClaim:funding.claim,
            vault:funding.vault, balanceDeltaVerified:true, fundedAt:new Date().toISOString() }; });
          funded += 1;
          continue;
        }
        const funding = request.asset === 'SOL'
          ? await chain.fundSolVaultFromMintRouter({ mint:request.mint, amount:request.amount, fundingId:request.id })
          : await chain.fundTokenVault({ mint:request.mint, asset:request.asset, amount:request.amount, decimals:request.decimals });
        const evidence = { fundingSignature:funding.signature || `existing:${funding.claim || funding.tokenAccount}`, balanceDeltaVerified:funding.balanceDeltaVerified, fundedAt:Math.floor(Date.now()/1000) };
        const scheduled = request.kind === 'holder'
          ? await scheduler.recordFundedPool({ id:request.id, mint:request.mint, asset:request.asset, amount:request.amount, ...evidence })
          : await scheduler.recordDirectFunded({ id:request.id, mint:request.mint, asset:request.asset, kind:request.kind, recipient:request.recipient, amount:request.amount, ...evidence });
        await store.transaction(state => { state.fundingRequests[request.id] = { ...state.fundingRequests[request.id], status:'funded', fundingSignature:funding.signature || null, fundingClaim:funding.claim || null, scheduleId:scheduled.id, balanceDeltaVerified:true, fundedAt:new Date().toISOString() }; });
        funded += 1;
      } catch (error) {
        await store.transaction(state => { state.fundingRequests[request.id] = { ...state.fundingRequests[request.id], status:'verification-pending', reason:String(error.message || error), lastAttemptAt:new Date().toISOString() }; });
      }
    }
    return { status:'processed', pending:requests.length, funded };
  }
  return { processPending };
}
