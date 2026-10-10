// Dependencies and mutable application state are read live through appState.
export function createCoinChatController(appState) {
  // app-source: 993
  function restoreCoinChatSession(address){
    try {
      const saved = JSON.parse(sessionStorage.getItem(appState.COIN_CHAT_SESSION_KEY) || 'null');
      if (!saved) return;
      const validToken = typeof saved.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(saved.token);
      if (validToken && saved.address === address && Number.isFinite(saved.expiresAtMs) && saved.expiresAtMs > Date.now() + 5_000) {
        appState.coinChatSession = { address, version: appState.walletVersion, token: saved.token, expiresAtMs: saved.expiresAtMs };
        return;
      }
      sessionStorage.removeItem(appState.COIN_CHAT_SESSION_KEY);
      if (validToken && saved.address !== address) void appState.apiRequest('/api/token-chat/session/revoke', { method: 'POST', headers: { 'x-token-chat-session': saved.token } }).catch(() => {});
    } catch { try { sessionStorage.removeItem(appState.COIN_CHAT_SESSION_KEY); } catch {} }
  }
  // app-source-end

  // app-source: 994
  function tokenChatSessionReady(){
    return appState.walletSignIn.ready(appState.captureWalletSession());
  }
  // app-source-end

  // app-source: 995
  function updateTokenChatComposerState(){
    const connected = Boolean(appState.connectedWalletAddress);
    const ready = appState.tokenChatSessionReady();
    document.querySelectorAll('#coin-chat-form, #coin-community-form').forEach(form => {
      const button = form.querySelector('button[type="submit"]');
      if (button) button.textContent = !connected ? 'Connect wallet' : ready ? 'Post' : 'Sign in & post';
      const note = form.nextElementSibling;
      if (note?.classList.contains('coin-chat-note')) note.textContent = !connected
        ? 'Connect a Solana wallet to post. A wallet address does not prove project affiliation.'
        : ready ? `Posting as ${appState.shortAddress(appState.connectedWalletAddress)} · wallet control does not prove project affiliation. Report impersonation.`
          : `Posting as ${appState.shortAddress(appState.connectedWalletAddress)} · sign in once to use token discussions. This does not verify project affiliation.`;
    });
  }
  // app-source-end

  // app-source: 996
  async function ensureTokenChatSession(session){
    await appState.ensureReferralSession(session, { interactive: true });
    appState.assertWalletSessionCurrent(session);
    return 'wallet';
  }
  // app-source-end

  // app-source: 997
  async function tokenChatRequest(action, payload){
    if (!appState.wallet) await appState.connectWallet();
    const session = appState.captureWalletSession();
    if (!session) throw new Error('Connect a Solana wallet to post.');
    const mint = appState.getCoinMintAddress();
    if (!mint) throw new Error('Token address is unavailable.');
    const identityField = { author: session.address };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await appState.ensureTokenChatSession(session);
      appState.assertWalletSessionCurrent(session);
      try {
        return await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/chat${action === 'post' ? '' : `/${action}`}`, { method: 'POST', headers: { 'x-token-chat-session': token }, body: { ...payload, ...identityField } });
      } catch (error) {
        if (attempt || !String(error.message).includes('Chat verification expired')) throw error;
        appState.walletSignIn.clear();
        appState.coinChatSession = null;
        try { sessionStorage.removeItem(appState.COIN_CHAT_SESSION_KEY); } catch {}
        appState.updateTokenChatComposerState();
      }
    }
  }
  // app-source-end

  // app-source: 998
  async function refreshCoinChat(){
    const mint = appState.getCoinMintAddress();
    if (mint) await appState.loadCoinChat(mint, appState.coinLoadId);
  }
  // app-source-end

  return { restoreCoinChatSession, tokenChatSessionReady, updateTokenChatComposerState, ensureTokenChatSession, tokenChatRequest, refreshCoinChat };
}
