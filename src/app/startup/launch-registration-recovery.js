export function initializeLaunchRegistrationRecovery(appState) {
  window.addEventListener('funded:recover-registration', async event => {
    const report = message => window.dispatchEvent(new CustomEvent('funded:recovery-result', { detail:message }));
    try {
      const { mint, id } = event.detail || {};
      const row = appState.readLaunchJournal().find(item => item.id === id && item.mint === mint
        && ['submitted', 'confirmed', 'unknown', 'verification-pending', 'registration-pending'].includes(item.state));
      if (!row || row.cluster !== 'devnet') throw new Error('No pending Solana registration matches this request.');
      const launchSignature = row.events?.filter(item => item.step === 'launch' && item.signature).at(-1)?.signature
        || (['verification-pending', 'registration-pending'].includes(row.state) ? row.signature : null);
      if (!launchSignature) throw new Error('The original Pump launch signature is missing. Check the saved receipts; no transaction will be sent.');
      const policy = JSON.parse(localStorage.getItem(`funded.launch.${mint}`) || 'null');
      if (!policy || policy.mint !== mint || policy.creatorWallet !== row.payer || policy.cluster !== 'devnet')
        throw new Error('Saved registration details are unavailable. Check the confirmed mint and receipt; do not recreate the coin.');
      if (!policy.signature) { policy.signature = launchSignature; policy.pumpFeeRoute.transaction = launchSignature; }
      if (!appState.policyMatchesJournal(policy, { ...row, signature:launchSignature }))
        throw new Error('Saved policy does not match this launch. Do not recreate the coin.');
      const session = appState.captureWalletSession();
      if (!session || session.address !== row.payer) throw new Error('Connect the original launch wallet before registration.');
      appState.assertWalletSessionCurrent(session);
      const listed = await appState.apiRequest('/api/launches');
      if (listed.available && Array.isArray(listed.data) && listed.data.some(item => item.onchainVerified === true
        && appState.policyMatchesJournal(item, { ...row, signature:launchSignature }))) {
        appState.recordLaunchEvent(id, { state:'completed', mint, signature:launchSignature });
        localStorage.removeItem(`funded.launch.${mint}`);
        report('Original launch is already registered. No duplicate coin was created.');
        void appState.loadVerifiedLaunchPolicies();
        return;
      }
      if (!policy.policySignature) {
        if (typeof session.provider.signMessage !== 'function') throw new Error('This wallet must support message signing.');
        const signed = await session.provider.signMessage(new TextEncoder().encode(appState.launchPolicyStatement(policy)));
        appState.assertWalletSessionCurrent(session);
        policy.policySignature = appState.bs58.encode(signed.signature || signed);
        localStorage.setItem(`funded.launch.${mint}`, JSON.stringify(policy));
      }
      report('Checking the original launch and policy with the API. No coin transaction is being sent.');
      const result = await appState.apiRequest('/api/launches', { method:'POST', body:policy });
      if (!result.available || result.data?.mint !== mint || !result.data?.onchainVerified)
        throw new Error('Registration is still pending verified API evidence.');
      if (appState.verifiedPilotLaunchRegistration(result, mint)) appState.emitPilotSignal('launch-confirmed');
      appState.recordLaunchEvent(id, { state:'completed', mint, signature:launchSignature });
      localStorage.removeItem(`funded.launch.${mint}`);
      report('Original launch registered. No duplicate launch was created.');
      void appState.loadVerifiedLaunchPolicies();
    } catch (error) { report(error.message); }
  });
}
