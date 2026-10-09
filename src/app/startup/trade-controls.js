import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeTradeControls(appState) {
  // app-source: 737
  try {
    const saved = JSON.parse(localStorage.getItem(appState.coinQuickAmountKey) || 'null');
    appState.applyCoinQuickAmounts(Array.isArray(saved) && saved.length === appState.coinQuickAmountButtons.length && saved.every(appState.validCoinQuickAmount) ? saved : appState.coinQuickAmountDefaults);
  } catch { appState.applyCoinQuickAmounts(appState.coinQuickAmountDefaults); }
  // app-source-end

  // app-source: 738
  const coinQuickDialog = document.querySelector('#coin-quick-edit-dialog');
  initializeAppState(appState, 'coinQuickDialog', coinQuickDialog);
  // app-source-end

  // app-source: 739
  const coinQuickFields = document.querySelector('#coin-quick-edit-fields');
  initializeAppState(appState, 'coinQuickFields', coinQuickFields);
  // app-source-end

  // app-source: 740
  if (appState.coinQuickFields) appState.coinQuickFields.innerHTML = appState.coinQuickAmountButtons.map((_, index) => `<label>Amount ${index + 1}<span><input type="text" inputmode="decimal" aria-label="Quick amount ${index + 1} in SOL" required /> SOL</span></label>`).join('');
  // app-source-end

  // app-source: 741
  document.querySelector('#coin-quick-edit-trigger')?.addEventListener('click', () => {
    const inputs = [...appState.coinQuickFields.querySelectorAll('input')];
    inputs.forEach((input, index) => { input.value = appState.coinQuickAmountButtons[index].dataset.coinBuyAmount; });
    document.querySelector('#coin-quick-edit-error').textContent = '';
    appState.coinQuickDialog.showModal();
    inputs[0]?.focus();
  });
  // app-source-end

  // app-source: 742
  document.querySelector('#coin-quick-edit-reset')?.addEventListener('click', () => {
    appState.coinQuickFields.querySelectorAll('input').forEach((input, index) => { input.value = appState.coinQuickAmountDefaults[index]; });
    document.querySelector('#coin-quick-edit-error').textContent = '';
  });
  // app-source-end

  // app-source: 743
  document.querySelector('#coin-quick-edit-cancel')?.addEventListener('click', () => appState.coinQuickDialog.close());
  // app-source-end

  // app-source: 744
  document.querySelector('#coin-quick-edit-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const values = [...appState.coinQuickFields.querySelectorAll('input')].map(input => input.value.trim());
    if (values.length !== appState.coinQuickAmountButtons.length || !values.every(appState.validCoinQuickAmount)) {
      document.querySelector('#coin-quick-edit-error').textContent = 'Enter six SOL amounts above 0 and at most 100, with up to nine decimal places.';
      return;
    }
    appState.applyCoinQuickAmounts(values);
    try { localStorage.setItem(appState.coinQuickAmountKey, JSON.stringify(values)); } catch {}
    appState.coinQuickDialog.close();
  });
  // app-source-end

  // app-source: 745
  appState.coinQuickDialog?.addEventListener('close', () => document.querySelector('#coin-quick-edit-trigger')?.focus());
  // app-source-end

  // app-source: 746
  document.querySelectorAll('[data-coin-sell-percent]').forEach(button => button.addEventListener('click', () => {
    if (document.querySelector('#trade-side')?.value !== 'sell' || appState.tradeBalanceState.key !== appState.tradeBalanceKey() || appState.tradeBalanceState.tokenRaw == null) return;
    const value = appState.tokenBalancePercentage(appState.tradeBalanceState.tokenRaw, appState.tradeBalanceState.tokenDecimals, Number(button.dataset.coinSellPercent));
    const amount = document.querySelector('#trade-amount');
    if (!amount) return;
    amount.value = appState.formatTradeAmountInput(value);
    amount.dispatchEvent(new Event('input', { bubbles:true }));
  }));
  // app-source-end

  // app-source: 748
  document.querySelectorAll('[data-coin-slippage]').forEach(button => button.addEventListener('click', () => {
    const input = document.querySelector('#trade-slippage');
    if (!input) return;
    input.value = button.dataset.coinSlippage;
    input.dispatchEvent(new Event('input', { bubbles:true }));
  }));
  // app-source-end

  // app-source: 749
  document.querySelector('#trade-slippage')?.addEventListener('input', appState.syncTradeSlippagePresets);
  // app-source-end

  // app-source: 750
  document.querySelector('#trade-mint')?.addEventListener('change', () => { appState.setTradeStatus('Mint selected. Calculating a live quote.'); void appState.refreshTradeBalances(); });
  // app-source-end

  // app-source: 751
  document.querySelector('#trade-amount')?.addEventListener('input', event => {
    const input = event.currentTarget;
    const caret = input.selectionStart;
    const formatted = appState.formatTradeAmountInput(input.value);
    if (formatted === input.value) return;
    const formattedPrefix = caret == null ? formatted : appState.formatTradeAmountInput(input.value.slice(0, caret));
    input.value = formatted;
    if (caret != null) input.setSelectionRange(formattedPrefix.length, formattedPrefix.length);
  });
  // app-source-end

  // app-source: 752
  const restoredTradeAmount = document.querySelector('#trade-amount');
  initializeAppState(appState, 'restoredTradeAmount', restoredTradeAmount);
  // app-source-end

  // app-source: 753
  if (appState.restoredTradeAmount?.value) appState.restoredTradeAmount.value = appState.formatTradeAmountInput(appState.restoredTradeAmount.value);
  // app-source-end

  // app-source: 754
  document.querySelectorAll('#trade-mint, #trade-amount, #trade-slippage, #trade-side').forEach(input => input.addEventListener('input', () => {
    appState.invalidateTradePreview();
    appState.renderTradeBalances();
    if (appState.tradeInputs().valid) { appState.setTradeStatus(appState.wallet ? 'Calculating a live quote…' : 'Connect a signing wallet to calculate the SOL amount.'); appState.queueTradeQuote(); }
    else appState.setTradeStatus('Enter a positive amount and slippage between 0.1% and 10%.');
  }));
  // app-source-end

  // app-source: 755
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !appState.tradeActionBusy && !document.querySelector('#trade-review-dialog')?.open && (!appState.tradePreview || Date.now() - appState.tradePreview.preparedAt >= 12_000)) { appState.invalidateTradePreview(); appState.queueTradeQuote(0); }
  });
  // app-source-end

  // app-source: 756
  appState.updateTradeAmountLabel();
  // app-source-end

  // app-source: 757
  appState.syncTradeSlippagePresets();
  // app-source-end

  // app-source: 758
  appState.queueTradeQuote();
  // app-source-end

  // app-source: 759
  appState.normalizePreviewLabels();
  // app-source-end

  // app-source: 760
  let pendingTradeMint = null;
  initializeAppState(appState, 'pendingTradeMint', pendingTradeMint);
  // app-source-end

  // app-source: 761
  try {
    const storedMint = sessionStorage.getItem('funded.pendingTradeMint');
    if (storedMint) {
      sessionStorage.removeItem('funded.pendingTradeMint');
      appState.pendingTradeMint = storedMint;
    }
  } catch { /* This optional handoff must not block startup or replay an unconsumed hint. */ }
  // app-source-end

  // app-source: 762
  const requestedTradeMint = appState.getCoinMintAddress();
  initializeAppState(appState, 'requestedTradeMint', requestedTradeMint);
  // app-source-end

  // app-source: 763
  if (appState.pendingTradeMint && (!appState.requestedTradeMint || appState.pendingTradeMint === appState.requestedTradeMint) && document.querySelector('#trade-mint')) {
    document.querySelector('#trade-mint').value = appState.pendingTradeMint;
    void appState.refreshTradeBalances();
    appState.setTradeStatus('Mint selected. Calculating a live quote.');
    appState.invalidateTradePreview();
    appState.queueTradeQuote();
    setTimeout(() => document.querySelector('#trade-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }
  // app-source-end

  // app-source: 764
  document.querySelectorAll('a[href="#launch"]').forEach(link => link.addEventListener('click', appState.openLaunchPage));
  // app-source-end

  // app-source: 765
  document.querySelector('#launch-form').addEventListener('submit', event => event.preventDefault());
  // app-source-end

}
