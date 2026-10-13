// Dependencies and mutable application state are read live through appState.
export function createCreatorFeesController(appState) {
  // app-source: 901
  function coinFeeSol(value) {
    try {
      const amount = BigInt(value);
      if (amount < 0n) return '—';
      const whole = amount / 1_000_000_000n;
      const fraction = String(amount % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
      return `${whole}${fraction ? `.${fraction}` : ''} SOL`;
    } catch { return '—'; }
  }
  // app-source-end

  // app-source: 905
  function renderCoinSummary(){
    return appState.renderCoinSummaryView({ coinSummaryLaunch: appState.coinSummaryLaunch, coinSummaryLedgerMint: appState.coinSummaryLedgerMint, currentCoinFeeOverview: appState.currentCoinFeeOverview, coinMarketActivity: appState.coinMarketActivity, coinSolUsdPrice: appState.coinSolUsdPrice, coinSolUsdValues: appState.coinSolUsdValues, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { getCoinMintAddress: appState.getCoinMintAddress });
  }
  // app-source-end

  // app-source: 906
  function renderCoinFeeDashboard(overview = null) {
    appState.currentCoinFeeOverview = overview;
    appState.renderCoinSummary();
    const root = document.querySelector('#coin-fee-dashboard');
    if (!root) return;
    const owned = Boolean(overview?.available && overview.scope === 'per-mint-v3'
      && appState.connectedWalletAddress && overview.creatorWallet === appState.connectedWalletAddress);
    root.hidden = !owned;
    root.replaceChildren();
    if (!owned) return;
    const collections = Array.isArray(overview.collections) ? overview.collections : [];
    if (!collections.length) {
      const note = document.createElement('p');
      note.textContent = 'No finalized V3 collection is ready for settlement.';
      root.append(note);
      return;
    }
    const signingWallet = Boolean(appState.wallet && !appState.wallet.readOnly
      && typeof appState.wallet.signTransaction === 'function');
    for (const row of collections) {
      const section = document.createElement('section'); section.className = 'coin-creator-claim';
      const summary = document.createElement('div');
      const title = document.createElement('span'); title.textContent = 'V3 collected creator fees';
      const amount = document.createElement('strong'); amount.textContent = appState.coinFeeSol(row.amountLamports);
      const detail = document.createElement('small');
      detail.textContent = row.settlement === 'finalized' && row.allocationPlan?.status !== 'allocated-not-funded'
        ? 'Finalized settlement needs allocation reconciliation before funding.'
        : row.settlement === 'finalized'
        ? 'Categories settled on Devnet. Fund each approved allocation separately.'
        : 'Settlement requires the launch creator to review and sign the V3 transaction.';
      summary.append(title, amount, detail); section.append(summary);
      const actions = row.settlement === 'finalized' && row.allocationPlan?.status === 'allocated-not-funded'
        ? [['community-funding','communityFunding','Fund community allocation'],
          ['creator-reward-funding','creatorRewardFunding','Fund holder and X rewards'],
          ['creator-wallet-payout','creatorWalletPayout','Receive creator allocation'],
          ['buyback','buyback','Buy back and burn $FUNDED']]
        : row.settlement === 'finalized' ? [] : [['settlement','settlement','Approve V3 settlement']];
      for (const [path, gate, label] of actions) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = row[gate] === 'finalized' ? `${label} · finalized` : label;
        let payable = true;
        if (path !== 'settlement') {
          try {
            const plan = row.allocationPlan;
            const amount = path === 'community-funding' ? BigInt(plan.protocol.communityLamports)
              : path === 'buyback' ? BigInt(plan.protocol.buybackLamports)
              : path === 'creator-reward-funding' ? BigInt(plan.creatorDirected.holderLamports)
                + BigInt(plan.creatorDirected.xLamports)
                : BigInt(plan.creatorDirected.walletLamports);
            payable = amount > 0n;
          } catch { payable = false; }
        }
        button.disabled = !signingWallet || overview.gates?.[gate] !== true
          || row[gate] === 'finalized' || !payable;
        if (!button.disabled) button.onclick = () => { void requestV3FeeAction(button, path, row.signature); };
        section.append(button);
      }
      root.append(section);
    }
  }
  // app-source-end

  // app-source: 909
  async function requestV3FeeAction(button, action, collectionSignature, mint = appState.getCoinMintAddress()) {
    const session = appState.captureWalletSession();
    const overview = appState.currentCoinFeeOverview;
    if (!session || !mint || overview?.scope !== 'per-mint-v3'
      || session.address !== overview.creatorWallet || appState.creatorClaimsInFlight.has(mint)) return;
    if (session.provider.readOnly || typeof session.provider.signTransaction !== 'function') {
      appState.showToast('Open the launch creator wallet to approve this V3 transaction.'); return;
    }
    const collection = overview.collections?.find(row => row.signature === collectionSignature);
    const gate = { settlement:'settlement', 'community-funding':'communityFunding',
      'creator-reward-funding':'creatorRewardFunding', 'creator-wallet-payout':'creatorWalletPayout',
      buyback:'buyback' }[action];
    if (!collection || !gate || overview.gates?.[gate] !== true) return;
    appState.creatorClaimsInFlight.add(mint);
    const originalLabel = button.textContent;
    try {
      button.disabled = true;
      button.textContent = 'Reviewing V3 transaction…';
      const path = `/api/tokens/${encodeURIComponent(mint)}/v3-${action}/${encodeURIComponent(collectionSignature)}`;
      const prepared = await appState.apiRequest(path, { method:'POST', body:{} });
      appState.assertWalletSessionCurrent(session);
      if (prepared.data?.status === 'finalized') {
        appState.showToast('This V3 allocation is already finalized.'); return;
      }
      if (prepared.data?.status !== 'awaiting-creator-signature'
        || prepared.data.mint !== mint || prepared.data.collectionSignature !== collectionSignature
        || !prepared.data.transaction) throw new Error('V3 transaction review is unavailable.');
      if (action === 'settlement' && prepared.data.creatorWallet !== session.address)
        throw new Error('The V3 settlement creator wallet changed.');
      if (action !== 'settlement' && action !== 'buyback' && !prepared.data.recipient)
        throw new Error('The V3 funding recipient is unavailable.');
      button.textContent = 'Waiting for creator wallet…';
      const { Transaction, VersionedTransaction } = await appState.getSolana();
      const transaction = action === 'buyback'
        ? VersionedTransaction.deserialize(appState.base64ToBytes(prepared.data.transaction))
        : Transaction.from(appState.base64ToBytes(prepared.data.transaction));
      const signed = await session.provider.signTransaction(transaction);
      appState.assertWalletSessionCurrent(session);
      button.textContent = 'Verifying finalized Devnet transaction…';
      const result = await appState.apiRequest(path, { method:'POST', body:{
        creatorSignedTransaction:appState.bytesToBase64(action === 'buyback'
          ? signed.serialize() : signed.serialize({
            requireAllSignatures:false, verifySignatures:false })) } });
      appState.assertWalletSessionCurrent(session);
      if (result.data?.status !== 'finalized') throw new Error('V3 transaction outcome is uncertain. Refresh before signing again.');
      appState.showToast('V3 transaction finalized on Devnet.');
      const updated = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/fee-activity`);
      appState.assertWalletSessionCurrent(session);
      if (appState.getCoinMintAddress() === mint && updated.available && updated.data?.mint === mint)
        appState.renderCoinFeeDashboard(updated.data.overview);
    } catch (error) {
      appState.showToast(`V3 transaction: ${error.message}`);
      if (button.isConnected) { button.disabled = false; button.textContent = originalLabel; }
    } finally { appState.creatorClaimsInFlight.delete(mint); }
  }
  // app-source-end

  return { coinFeeSol, renderCoinSummary, renderCoinFeeDashboard, requestV3FeeAction };
}
