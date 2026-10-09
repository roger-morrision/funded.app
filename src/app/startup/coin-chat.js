// Startup runs in the order declared in start.js.
export function initializeCoinChat(appState) {
  // app-source: 999
  document.querySelector('#coin-page')?.addEventListener('submit', async event => {
    const form = event.target.closest('#coin-chat-form, #coin-community-form');
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector('#coin-chat-input, #coin-community-input');
    const text = input?.value.trim();
    const mint = appState.getCoinMintAddress();
    if (!text || !mint) return;
    const button = form.querySelector('button');
    if (button) button.disabled = true;
    try {
      const response = await appState.tokenChatRequest('post', { text: appState.normalizeTokenChatText(text) });
      if (response.available && response.data?.message) appState.coinChatMessages = [...appState.coinChatMessages, response.data.message].slice(-50);
      input.value = '';
      appState.renderCoinChat(document.querySelector('#coin-activity-list'));
      appState.renderCoinCommunityPanel();
      appState.showToast('Wallet-verified message posted');
    } catch (error) { appState.showToast(error.message || 'Chat message could not be sent'); }
    finally { if (button) button.disabled = false; }
  });
  // app-source-end

  // app-source: 1000
  document.querySelector('#coin-trade-refine')?.addEventListener('input', event => {
    if (!event.target.matches('[data-coin-trade-input]')) return;
    if (event.target.dataset.coinTradeInput === 'side') {
      appState.coinTradeFilter = event.target.value;
      document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === appState.coinTradeFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    }
    appState.renderCoinActivityTab();
  });
  // app-source-end

  // app-source: 1001
  document.querySelector('#coin-trade-wallet')?.addEventListener('input', appState.renderCoinActivityTab);
  // app-source-end

  // app-source: 1002
  document.querySelector('.coin-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-coin-tab]')];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
  // app-source-end

  // app-source: 1003
  appState.initProgramPicker({ isWalletConnected: () => appState.canSignTransactions(appState.wallet) });
  // app-source-end

}
