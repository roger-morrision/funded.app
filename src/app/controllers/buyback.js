import { readPendingBurn } from '../../features/funded/burn-recovery.js';
import { mountBuybackProgressPanels } from '../../features/funded/buyback-progress-ui.js';
import { fundedBurnFailureMessage } from '../../features/funded/buy-feedback.js';

// Dependencies and mutable application state are read live through appState.
// Share of the trigger already in eligible vaults, e.g. "<0.01%" or "42.5%".
export function triggerProgressPercent(lamports, threshold) {
  if (typeof lamports !== 'bigint' || typeof threshold !== 'bigint' || threshold <= 0n) return 'progress unavailable';
  const basisPoints = lamports >= threshold ? 10_000n : lamports * 10_000n / threshold;
  if (basisPoints === 0n) return lamports > 0n ? '<0.01%' : '0%';
  return `${(Number(basisPoints) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function createBuybackController(appState) {
  let activeRead;
  // app-source: 341
  function getBuybackPreviewState(){
    return { accruals: [], receipts: [] };
  }
  // app-source-end

  // app-source: 343
  async function loadBuybackNetworkState(signal){
    activeRead?.abort();
    const owner = new AbortController();
    activeRead = owner;
    const current = AbortSignal.any([owner.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    try {
      // Public reads return before a slow custody scan. Follow that same scan
      // briefly so the normal minute-long polling interval does not hide it.
      for (let attempt = 0; attempt < 14; attempt++) {
        await readBuybackNetworkState(current);
        if (!appState.buybackNetworkState.refreshing || attempt === 13) break;
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(current.reason); };
          const timer = setTimeout(() => { current.removeEventListener('abort', abort); resolve(); }, 2_000);
          current.addEventListener('abort', abort, {once:true});
          if (current.aborted) abort();
        });
      }
    } catch (error) {
      if (!current.aborted) throw error;
    } finally {
      if (activeRead === owner) activeRead = null;
    }
  }

  async function readBuybackNetworkState(signal){
    mountBuybackProgressPanels(document);
    try {
      const deadline = AbortSignal.timeout(30_000);
      const response = await appState.apiRequest('/api/buyback/status', { signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
      signal?.throwIfAborted();
      if (!response.available || !response.data || response.data.cluster !== 'devnet') throw new Error('Devnet buyback index unavailable.');
      appState.buybackNetworkState = { status:'ready', receipts:Array.isArray(response.data.receipts) ? response.data.receipts : [], pending:Array.isArray(response.data.pending) ? response.data.pending : [], dashboard:response.data.dashboard || null, automationEnabled:response.data.automationEnabled === true,
        executionReady:response.data.executionReady === true, minimumOrderLamports:response.data.minimumOrderLamports,
        budgetSummary:response.data.budgetSummary,lastVerified:response.data.lastVerified,refreshing:response.data.refreshing };
    } catch { signal?.throwIfAborted(); appState.buybackNetworkState = { status:'unavailable', receipts:[], pending:[], dashboard:null }; }
    const dashboard = appState.buybackNetworkState.dashboard;
    for (const prefix of ['home-buyback','buyback-route']) {
      const balance = document.querySelector(`#${prefix}-balance`);
      const note = document.querySelector(`#${prefix}-status`);
      const track = document.querySelector(`#${prefix}-track`);
      const fill = document.querySelector(`#${prefix}-fill`);
      const time = document.querySelector(`#${prefix}-last-time`);
      const proof = document.querySelector(`#${prefix}-proof`);
      if (!balance || !note || !track || !fill || !time || !proof) continue;
      const eligible = dashboard?.status === 'verified' && /^\d+$/.test(String(dashboard.collectedLamports));
      const unindexed = dashboard?.unindexedStatus === 'verified'
        && /^\d+$/.test(String(dashboard.unindexedLamports));
      const unindexedLamports = unindexed ? BigInt(dashboard.unindexedLamports) : 0n;
      const lamports = eligible ? BigInt(dashboard.collectedLamports) : 0n;
      const older = document.querySelector(`#${prefix}-older`);
      const threshold = /^\d+$/.test(String(dashboard?.thresholdLamports))
        && BigInt(dashboard.thresholdLamports) > 0n ? BigInt(dashboard.thresholdLamports) : null;
      const formatSol = value => `${(Number(value) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits:9 })} SOL`;
      const trigger = threshold === null ? null : formatSol(threshold);
      const minimumOrder = /^\d+$/.test(String(appState.buybackNetworkState.minimumOrderLamports))
        ? BigInt(appState.buybackNetworkState.minimumOrderLamports) : null;
      const belowMinimum = appState.buybackNetworkState.pending?.length > 0
        && appState.buybackNetworkState.pending.every(row => row.status === 'below-minimum-order');
      balance.textContent = eligible ? formatSol(lamports) : '—';
      if (older) {
        older.hidden = !eligible || !unindexed || unindexedLamports === 0n;
        older.textContent = older.hidden ? ''
          : `Older verified vault custody included: ${formatSol(unindexedLamports)} · total eligible ${formatSol(lamports)}`;
      }
      const triggerText = document.querySelector(`#${prefix}-trigger`);
      if (triggerText) triggerText.textContent = trigger ? `${trigger} trigger` : 'Trigger unavailable';
      const policy = document.querySelector(`#${prefix}-policy`);
      if (policy && trigger) policy.textContent = prefix === 'home-buyback'
        ? `For launches using the published 5% buyback split, that share goes into dedicated on-chain vaults. At ${trigger} in verified vault allocations, the app reviews protected $FUNDED purchases and burns. Each order must meet its own minimum and pass market quote and liquidity checks.`
        : `The published buyback share of collected creator fees remains in dedicated program vaults until verified vault allocations reach the ${trigger} aggregate trigger. The worker then reviews individual orders for protected $FUNDED purchases and burns; orders below their minimum and failed market checks leave funds in custody.`;
      if (prefix === 'buyback-route' && trigger) document.querySelector('#buyback-route-title').textContent = `${trigger} trigger, verified eligible fees.`;
      note.textContent = !eligible && appState.buybackNetworkState.refreshing ? 'Checking finalized vault balances…'
        : !eligible || !trigger ? 'Eligible vault or trigger verification unavailable or incomplete'
        : !appState.buybackNetworkState.automationEnabled ? 'Automatic execution is not active on this deployment'
          : dashboard.triggerReached && !appState.buybackNetworkState.executionReady && belowMinimum && minimumOrder
            ? `${trigger} aggregate trigger reached · individual allocations below ${formatSol(minimumOrder)} order minimum`
            : dashboard.triggerReached && !appState.buybackNetworkState.executionReady
              ? `${trigger} aggregate trigger reached · no executable allocation yet`
              : dashboard.triggerReached ? `${trigger} trigger reached · protected execution ready`
                : `Verified eligible funds · ${triggerProgressPercent(lamports, threshold)} of the ${trigger} trigger`;
      const sizes=appState.buybackNetworkState.budgetSummary;
      if(eligible&&sizes&&/^\d+$/.test(sizes.orderSizeEligibleLamports)&&/^\d+$/.test(sizes.belowMinimumLamports))
        note.textContent+=` · Meets order minimum: ${formatSol(BigInt(sizes.orderSizeEligibleLamports))} · Retained below minimum: ${formatSol(BigInt(sizes.belowMinimumLamports))}`;
      if(!eligible&&appState.buybackNetworkState.lastVerified?.checkedAt)
        note.textContent+=` · Last verified ${appState.formatOnchainAge(Date.parse(appState.buybackNetworkState.lastVerified.checkedAt))}; ${appState.buybackNetworkState.refreshing ? 'current verification pending' : 'current verification unavailable'}`;
      const progress = eligible && threshold ? Number(lamports > threshold ? threshold : lamports) / Number(threshold) * 100 : 0;
      track.setAttribute('aria-label', trigger ? `Eligible buyback progress toward ${trigger}` : 'Eligible buyback progress unavailable');
      if (threshold) {
        track.setAttribute('aria-valuemax',String(Number(threshold)/1_000_000_000));
        track.setAttribute('aria-valuenow', String(eligible ? Number(lamports > threshold ? threshold : lamports) / 1_000_000_000 : 0));
      } else {
        track.removeAttribute('aria-valuemax');
        track.removeAttribute('aria-valuenow');
      }
      track.setAttribute('aria-valuetext', eligible && trigger
        ? `${formatSol(lamports)} of ${trigger} eligible for automatic buyback`
        : 'Eligible balance or trigger unavailable');
      fill.style.width = `${progress}%`;
      const burn = dashboard?.lastBurn;
      const burnedAt = burn?.burnedAt && Number.isFinite(Date.parse(burn.burnedAt)) ? new Date(burn.burnedAt) : null;
      const burnTime = burnedAt ? burnedAt.toLocaleString(undefined,{timeZone:'UTC',timeZoneName:'short'}) : 'time unavailable';
      time.textContent = burn ? `${burn.source === 'onchain-unindexed' ? 'QA on-chain burn · ' : ''}${burnTime}`
        : dashboard?.historyStatus === 'unavailable' ? 'Burn history temporarily unavailable'
          : dashboard?.status === 'verified' ? 'No burns yet' : 'Waiting for the next burn update';
      const signature = String(burn?.signature || '');
      proof.hidden = !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature);
      if (!proof.hidden) proof.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
      else proof.removeAttribute('href');
    }
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
    const buybackPercent = appState.FEE_DISTRIBUTION.buybackEffectivePercent;
    help.textContent = input.value.trim() && Number.isFinite(fees) && fees > 0
      ? `${appState.formatBuybackAmount(fees, 9)} SOL in gross fees would allocate ${appState.formatBuybackAmount(fees * buybackPercent / 100, 9)} SOL (${buybackPercent}%) to buybacks. Local calculation only; no claim recorded.`
      : `Enter gross creator fees above zero to preview the ${buybackPercent}% buyback allocation.`;
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
    const pending = readPendingBurn();
    if (pending || appState.fundedBurnBusy) {
      input.disabled = true;
      button.textContent = appState.fundedBurnBusy ? 'Checking burn...' : 'Check burn status';
      button.disabled = Boolean(appState.fundedBurnBusy) || pending?.wallet !== appState.connectedWalletAddress;
      button.title = pending ? `Original burn: ${pending.signature}. Reconnect ${pending.wallet} to verify; no new burn will be signed.` : 'Waiting for your burn.';
      return;
    }
    button.textContent = 'Burn $FUNDED';
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
    const note = balance?.closest('.wallet-popover-balance')?.parentElement?.querySelector('em');
    const currentWallet = Boolean(appState.connectedWalletAddress && appState.fundedBurnState.wallet === appState.connectedWalletAddress);
    const ready = currentWallet && appState.fundedBurnState.status === 'ready';
    const amount = ready ? appState.formatTokenBaseUnits(appState.fundedBurnState.balanceBaseUnits, appState.fundedBurnState.decimals, 6) : null;
    if (balance) balance.textContent = amount ?? '—';
    const airdropBalance = document.querySelector('#airdrop-funded-balance');
    if (airdropBalance) {
      airdropBalance.hidden = !appState.connectedWalletAddress;
      airdropBalance.querySelector('strong').textContent = ready ? `${amount} $FUNDED`
        : currentWallet && appState.fundedBurnState.status === 'error' ? 'Balance unavailable' : 'Checking balance…';
    }
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
      document.dispatchEvent(new Event('funded:analytics-summary'));
    } catch (error) {
      if (request !== appState.fundedBurnRequest) return;
      appState.fundedBurnState = { ...appState.fundedBurnState, status: 'error', wallet: address,
        message: fundedBurnFailureMessage(error) };
    }
    appState.renderBuybackDashboard();
    appState.renderWalletFundedBalance();
    appState.renderFundedTokenLanding();
    if (document.querySelector('#wallet-page:not([hidden])')) appState.renderWalletDetail();
  }
  // app-source-end

  return { getBuybackPreviewState, loadBuybackNetworkState, saveBuybackPreviewState, formatBuybackAmount, renderBuybackExample, fundedReceiptProject, updateFundedBurnButton, renderWalletFundedBalance, loadFundedBurnState };
}
