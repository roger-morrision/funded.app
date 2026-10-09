// Dependencies and mutable application state are read live through appState.
export function createTradeControlsController(appState) {
  // app-source: 735
  function validCoinQuickAmount(value) {
    return /^\d+(?:\.\d{1,9})?$/.test(String(value)) && Number(value) > 0 && Number(value) <= 100;
  }
  // app-source-end

  // app-source: 736
  function applyCoinQuickAmounts(values) {
    appState.coinQuickAmountButtons.forEach((button, index) => {
      button.dataset.coinBuyAmount = String(values[index]);
      button.textContent = `${values[index]} SOL`;
    });
  }
  // app-source-end

  // app-source: 747
  function syncTradeSlippagePresets(){
    const value = Number(document.querySelector('#trade-slippage')?.value);
    document.querySelectorAll('[data-coin-slippage]').forEach(button => {
      const active = Number(button.dataset.coinSlippage) === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  // app-source-end

  return { validCoinQuickAmount, applyCoinQuickAmounts, syncTradeSlippagePresets };
}
