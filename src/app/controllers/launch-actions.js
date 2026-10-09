// Dependencies and mutable application state are read live through appState.
export function createLaunchActionsController(appState) {
  // app-source: 663
  async function simulateLaunch(){
    const name = document.querySelector('#token-name').value.trim(); const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase(); const supply = Number(document.querySelector('#token-supply').value); const decimals = Number(document.querySelector('#token-decimals').value);
    try {
      const [{ Keypair, PublicKey, Transaction }, { PUMP_SDK }, { normalizeLaunchInput }] = await Promise.all([import('@solana/web3.js'), import('@pump-fun/pump-sdk'), import('../../../launch-core.js')]);
      const input = normalizeLaunchInput({ name, symbol, supply, decimals }); const payer = Keypair.generate(); const mint = Keypair.generate();
      const router = appState.feeRouterState.address ? new PublicKey(appState.feeRouterState.address) : Keypair.generate().publicKey;
      appState.setLaunchStatus('Dry run: building one Pump launch with the router as creator-fee owner…');
      const createInstruction = await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer.publicKey, mayhemMode: false, holderReward: false });
      const launchTransaction = new Transaction().add(createInstruction); const blockhash = Keypair.generate().publicKey.toBase58();
      launchTransaction.recentBlockhash = blockhash; launchTransaction.feePayer = payer.publicKey; launchTransaction.partialSign(mint, payer);
      const launchBytes = launchTransaction.serialize().length;
      appState.setLaunchStatus(`Dry run passed for ${input.name} (${input.symbol}).\nMint: ${mint.publicKey.toBase58()}\nPump launch transaction: ${launchBytes} bytes\nPump creator-fee owner: ${router.toBase58()}\nPaying user is not the fee owner.${appState.feeRouterState.verified ? '' : '\nTemporary dry-run address used; production router is not configured.'}\nNo network transaction was submitted.`); appState.showToast('Pump fee-route dry run passed');
    } catch (error) { appState.setLaunchStatus(`Dry run failed: ${error.message}`, true); }
  }
  // app-source-end

  // app-source: 694
  function updateOnboardingProgress(){
    const steps = document.querySelectorAll('[data-onboarding-step]');
    if (!steps.length) return;
    const complete = { creator: appState.canSignTransactions(appState.wallet), launch: appState.getWalletLaunchPolicies().length > 0, share: Boolean(appState.getReferralCode()) };
    let count = 0;
    steps.forEach(step => { const done = Boolean(complete[step.dataset.onboardingStep]); step.classList.toggle('complete', done); if (done) count += 1; });
    const progress = document.querySelector('#onboarding-progress');
    if (progress) progress.textContent = `${count} of 3 complete`;
  }
  // app-source-end

  // app-source: 699
  function updateLaunchPolicyControls(){
    const xShare = Number(document.querySelector('#x-share')?.value) || 0;
    document.querySelector('#x-recipient').disabled = xShare <= 0;
    appState.updateLaunchPreview();
    appState.updateLaunchButton();
  }
  // app-source-end

  // app-source: 726
  function resetSolClaimStatus() {
    return appState.resetSolClaimStatusFeature({ captureWalletSession: appState.captureWalletSession, syncXClaimFlow: appState.syncXClaimFlow });
  }
  // app-source-end

  return { simulateLaunch, updateOnboardingProgress, updateLaunchPolicyControls, resetSolClaimStatus };
}
