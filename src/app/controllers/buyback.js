// Dependencies and mutable application state are read live through appState.
export function createBuybackController(appState) {
  // app-source: 341
  function getBuybackPreviewState(){
    return { accruals: [], receipts: [] };
  }
  // app-source-end

  // app-source: 343
  async function loadBuybackNetworkState(signal){
    try {
      const response = await appState.apiRequest('/api/buyback/status', { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
      signal?.throwIfAborted();
      if (!response.available || !response.data || response.data.cluster !== 'devnet') throw new Error('Devnet buyback index unavailable.');
      appState.buybackNetworkState = { status:'ready', receipts:Array.isArray(response.data.receipts) ? response.data.receipts : [], pending:Array.isArray(response.data.pending) ? response.data.pending : [] };
    } catch { signal?.throwIfAborted(); appState.buybackNetworkState = { status:'unavailable', receipts:[], pending:[] }; }
    appState.renderBuybackDashboard();
  }
  // app-source-end

  // app-source: 344
  function saveBuybackPreviewState(state){ localStorage.setItem(appState.BUYBACK_PREVIEW_KEY, JSON.stringify(state)); }
  // app-source-end

  // app-source: 345
  function formatBuybackAmount(value, maximumFractionDigits = 4){ return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits }); }
  // app-source-end

  // app-source: 346
  function renderBuybackExample(){
    const input = document.querySelector('#buyback-example-fees');
    const help = input?.parentElement?.querySelector('.field-help');
    if (!help) return;
    const fees = Number(input.value);
    help.textContent = input.value.trim() && Number.isFinite(fees) && fees > 0
      ? `${appState.formatBuybackAmount(fees, 9)} SOL in gross fees would allocate ${appState.formatBuybackAmount(fees * 0.01, 9)} SOL (1%) to buybacks. Local calculation only; no claim recorded.`
      : 'Enter gross creator fees above zero to preview the 1% buyback allocation.';
  }
  // app-source-end

  // app-source: 347
  function fundedReceiptProject(receipt){
    if (!receipt?.projectMint) return 'No project attribution';
    const launch = appState.verifiedLaunchPolicies.find(item => item.mint === receipt.projectMint);
    return launch ? `${launch.name || 'Solana coin'} (${launch.symbol || 'TOKEN'})` : `${receipt.projectMint.slice(0, 4)}…${receipt.projectMint.slice(-4)}`;
  }
  // app-source-end

  // app-source: 348
  function updateFundedBurnButton(){
    const input = document.querySelector('#funded-burn-amount');
    const button = document.querySelector('#funded-burn-submit');
    if (!input || !button) return;
    const signingReady = appState.fundedBurnState.status === 'ready' && Boolean(appState.wallet && appState.canSignTransactions(appState.wallet));
    let reason = '';
    try {
      const amount = appState.parseTokenAmount(input.value, appState.fundedBurnState.decimals);
      if (amount > appState.fundedBurnState.balanceBaseUnits) reason = 'The burn amount exceeds this wallet’s $FUNDED balance.';
    } catch (error) { reason = error.message; }
    input.disabled = !signingReady || appState.fundedBurnState.balanceBaseUnits <= 0n;
    button.disabled = input.disabled || Boolean(reason) || appState.fundedBurnState.status === 'submitting';
    button.title = input.disabled
      ? (appState.fundedBurnState.status === 'loading' ? 'Loading the on-chain $FUNDED balance.' : 'Connect a signing wallet with a verified $FUNDED balance.')
      : reason;
  }
  // app-source-end

  // app-source: 349
  function renderWalletFundedBalance(){
    const balance = document.querySelector('#wallet-popover-funded');
    if (!balance) return;
    const note = balance.closest('.wallet-popover-balance')?.parentElement?.querySelector('em');
    const currentWallet = Boolean(appState.connectedWalletAddress && appState.fundedBurnState.wallet === appState.connectedWalletAddress);
    const ready = currentWallet && appState.fundedBurnState.status === 'ready';
    balance.textContent = ready ? appState.formatTokenBaseUnits(appState.fundedBurnState.balanceBaseUnits, appState.fundedBurnState.decimals, 6) : '—';
    if (note) note.textContent = ready ? 'Live SPL token balance' : currentWallet && appState.fundedBurnState.status === 'loading' ? 'Loading from Devnet' : 'Balance unavailable';
    appState.renderLaunchBurnSelection();
  }
  // app-source-end

  // app-source: 350
  async function loadFundedBurnState({ force = false } = {}){
    const address = appState.connectedWalletAddress;
    if (!force && appState.fundedBurnState.status === 'loading') return;
    if (!force && appState.fundedBurnState.status === 'ready' && appState.fundedBurnState.wallet === address && Date.now() - (appState.fundedBurnState.loadedAt || 0) < 30_000) return;
    const request = ++appState.fundedBurnRequest;
    appState.fundedBurnState = { ...appState.fundedBurnState, status: 'loading', wallet: address, message: 'Checking your $FUNDED balance and burn history…' };
    appState.renderBuybackDashboard();
    appState.renderWalletFundedBalance();
    try {
      if (!appState.PROTOCOL_FUNDED_MINT) throw new Error('The protocol $FUNDED mint is not configured.');
      const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint, unpackAccount } = await appState.getSolana();
      const mint = new PublicKey(appState.PROTOCOL_FUNDED_MINT);
      const mintAccount = await appState.connection.getAccountInfo(mint, 'confirmed');
      if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The configured $FUNDED mint is not a supported SPL mint on Solana.');
      const tokenProgram = mintAccount.owner;
      const mintState = await getMint(appState.connection, mint, 'confirmed', tokenProgram);
      let tokenAccounts = [];
      let balanceBaseUnits = 0n;
      if (address) {
        const owner = new PublicKey(address);
        const response = await appState.connection.getTokenAccountsByOwner(owner, { mint }, 'confirmed');
        tokenAccounts = response.value.map(row => {
          const account = unpackAccount(row.pubkey, row.account, tokenProgram);
          return { address: row.pubkey, amount: account.amount };
        }).filter(row => row.amount > 0n).sort((a, b) => a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1);
        balanceBaseUnits = tokenAccounts.reduce((sum, row) => sum + row.amount, 0n);
      }
      const indexed = address ? await appState.apiRequest(`/api/burn-receipts?wallet=${encodeURIComponent(address)}`).catch(() => ({ available: false })) : { available: true, data: { receipts: [] } };
      if (request !== appState.fundedBurnRequest || address !== appState.connectedWalletAddress) return;
      appState.fundedBurnState = {
        status: 'ready', wallet: address, decimals: mintState.decimals, balanceBaseUnits,
        supplyBaseUnits: mintState.supply, burnedBaseUnits: appState.burnedSupplyBaseUnits(mintState.supply, mintState.decimals),
        tokenProgram, tokenAccounts, receipts: indexed.available && Array.isArray(indexed.data?.receipts) ? indexed.data.receipts : [],
        receiptIndexAvailable: indexed.available, loadedAt: Date.now(), message: address
          ? (indexed.available ? 'Your balance and burn history are ready.' : 'Your balance is ready; burn history is unavailable.')
          : 'Live Solana supply loaded. Connect a wallet to view its balance and burn receipts.',
      };
    } catch (error) {
      if (request !== appState.fundedBurnRequest) return;
      const detail = String(error?.message || '');
      const unavailable = /(?:5\d\d (?:Internal Server Error|Bad Gateway)|returned an invalid response|failed to fetch|networkerror|econnrefused|\b429\b|rate limit|too many requests)/i.test(detail);
      appState.fundedBurnState = { ...appState.fundedBurnState, status: 'error', wallet: address, message: unavailable
        ? 'Solana RPC unavailable; $FUNDED mint and balance could not be verified.'
        : detail || 'Solana burn data is unavailable.' };
    }
    appState.renderBuybackDashboard();
    appState.renderWalletFundedBalance();
    appState.renderFundedTokenLanding();
    if (document.querySelector('#wallet-page:not([hidden])')) appState.renderWalletDetail();
  }
  // app-source-end

  return { getBuybackPreviewState, loadBuybackNetworkState, saveBuybackPreviewState, formatBuybackAmount, renderBuybackExample, fundedReceiptProject, updateFundedBurnButton, renderWalletFundedBalance, loadFundedBurnState };
}
