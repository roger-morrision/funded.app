// Dependencies and mutable application state are read live through appState.
export function createLaunchNavigationController(appState) {
  // app-source: 656
  function mountLaunchPage(){
    const shell = document.querySelector('#launch-route-shell');
    const page = document.querySelector('#launch-dialog');
    if (shell && page && !shell.contains(page)) shell.append(page);
    if (page) page.dataset.step = String(appState.launchStep);
    const preview = page?.querySelector('.launch-preview');
    const costSummary = page?.querySelector('#cost-summary');
    const previewEconomics = preview?.querySelector('.preview-economics');
    if (preview && costSummary && previewEconomics && !preview.contains(costSummary)) preview.insertBefore(costSummary, previewEconomics);
  }
  // app-source-end

  // app-source: 658
  function openLaunchPage(event){
    event?.preventDefault();
    if(event?.currentTarget instanceof HTMLElement)appState.launchOpener=event.currentTarget;
    if (location.hash !== '#launch') location.hash = '#launch'; else appState.syncPageRoute();
    appState.setLaunchStep(1);
  }
  // app-source-end

  // app-source: 659
  function openLaunchedCoinPage(launchPolicy){
    const mint = launchPolicy?.mint || '';
    if (!appState.validateSolanaMint(mint).valid) return;
    location.assign(`/token/${encodeURIComponent(mint)}`);
  }
  // app-source-end

  // app-source: 661
  async function requestAirdrop(){
    if (appState.APP_CLUSTER !== 'devnet') { appState.setLaunchStatus('Test SOL is available only on Devnet. No faucet request was sent.', true); return; }
    if (appState.airdropRequestInFlight) return;
    appState.airdropRequestInFlight = true;
    const button = document.querySelector('#airdrop-button'); button.disabled = true;
    let session = null, signature = '', requestStarted = false;
    const transactionLinks = () => [{ label: 'View airdrop transaction on Explorer', href: appState.explorer(`tx/${encodeURIComponent(signature)}`) }];
    const walletLinks = () => [{ label: 'View Devnet wallet on Explorer', href: appState.explorer(`address/${encodeURIComponent(session.address)}`) }];
    try {
      if (!appState.wallet) { await appState.connectWallet(); if (!appState.wallet) return; }
      session = appState.captureWalletSession();
      if (!session) return;
      const { LAMPORTS_PER_SOL } = await appState.getSolana();
      appState.assertWalletSessionCurrent(session);
      appState.setLaunchStatus('Requesting 1 Devnet SOL…');
      requestStarted = true;
      const receipt = await appState.connection.requestAirdrop(session.provider.publicKey, LAMPORTS_PER_SOL);
      if (!appState.isWalletSessionCurrent(session)) return;
      let validSignature = false;
      if (typeof receipt === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt)) {
        try { validSignature = appState.bs58.decode(receipt).length === 64; } catch { /* Unknown receipt; never build a transaction link from it. */ }
      }
      if (!validSignature) {
        appState.setLaunchLinks('The faucet request outcome is unknown; no valid transaction signature was returned. Check this Devnet wallet on Explorer before requesting more test SOL.', walletLinks(), true);
        return;
      }
      signature = receipt;
      const confirmation = await appState.connection.confirmTransaction(signature, 'confirmed');
      if (!appState.isWalletSessionCurrent(session)) return;
      if (confirmation?.value?.err === null) {
        appState.setLaunchLinks('Airdrop confirmed.', transactionLinks());
        // Refresh failures concern the displayed balance, not the confirmed receipt.
        try { await appState.refreshWalletInfo(); }
        catch { if (appState.isWalletSessionCurrent(session)) appState.setLaunchLinks('Airdrop confirmed. The wallet balance could not be refreshed; check the transaction on Explorer.', transactionLinks()); }
      } else if (confirmation?.value?.err !== undefined) {
        appState.setLaunchLinks('The airdrop transaction failed on Devnet. Review its result on Explorer before requesting more test SOL.', transactionLinks(), true);
      } else {
        appState.setLaunchLinks('Airdrop outcome is unknown because confirmation was incomplete. Check this transaction on Explorer before requesting more test SOL.', transactionLinks(), true);
      }
    } catch (error) {
      if (!session || !appState.isWalletSessionCurrent(session)) return;
      if (signature) {
        appState.setLaunchLinks('Airdrop outcome is unknown. Confirmation could not be completed. Check this transaction on Explorer before requesting more test SOL.', transactionLinks(), true);
      } else if (!requestStarted) {
        appState.setLaunchStatus('The Devnet airdrop could not be prepared. Check your wallet connection and try again.', true);
      } else {
        const message = String(error?.message || error).toLowerCase();
        const uncertain = /timed?\s*out|timeout|network|failed to fetch|disconnect|socket|abort|internal error|service unavailable/.test(message);
        const faucetIssue = /429|rate limit|faucet|unsupported solana rpc request|not allowed|disabled/.test(message);
        if (faucetIssue && !uncertain) {
          appState.setLaunchLinks('The API faucet did not confirm this request. Check your Devnet wallet balance before using the Solana Faucet.', [{ label: 'Open Solana Faucet', href: 'https://faucet.solana.com/' }], true);
        } else {
          appState.setLaunchLinks('The faucet request outcome is unknown; no transaction signature was returned. Check this Devnet wallet on Explorer before requesting more test SOL.', walletLinks(), true);
        }
      }
    } finally { appState.airdropRequestInFlight = false; button.disabled = false; }
  }
  // app-source-end

  return { mountLaunchPage, openLaunchPage, openLaunchedCoinPage, requestAirdrop };
}
