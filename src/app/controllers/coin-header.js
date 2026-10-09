// Dependencies and mutable application state are read live through appState.
export function createCoinHeaderController(appState) {
  // app-source: 924
  function getCoinMintAddress(){
    const pathMatch = location.pathname.match(/\/(?:token|launch\/coin)\/([^/?#]+)/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
    const hashMatch = location.hash.match(/^#coin\/([^/?#]+)/i);
    const hashValue = hashMatch?.[1] ? decodeURIComponent(hashMatch[1]) : '';
    return hashValue.length > 20 ? hashValue : '';
  }
  // app-source-end

  // app-source: 925
  function renderCoinCreatorRoute(address){
    const route = document.querySelector('#coin-creator-route');
    if (!route) return;
    if (!address) { route.innerHTML = '<strong>Fee recipient unavailable</strong><small>The curve fee-owner address could not be verified.</small>'; return; }
    const safe = appState.escapeHtml(address);
    route.innerHTML = `<strong>Pump fee recipient</strong><a class="coin-creator-link" href="/wallet/${encodeURIComponent(address)}">${safe}</a><button type="button" class="copy-creator-wallet" id="coin-copy-creator" aria-label="Copy fee recipient">${appState.icon('copy')}</button><small>Curve fee authority; may be a program/router, not the human creator.</small>`;
  }
  // app-source-end

  // app-source: 926
  function renderCoinCreatorHeader(address){
    const link = document.querySelector('#coin-creator-by');
    if (!link) return;
    if (!address) { link.hidden = true; link.removeAttribute('href'); return; }
    link.textContent = `Fee owner ${appState.shortAddress(address)}`;
    link.href = `/wallet/${encodeURIComponent(address)}`;
    link.hidden = false;
  }
  // app-source-end

  // app-source: 927
  function renderCoinRewardsPolicy(policy, mint = appState.getCoinMintAddress()){
    return appState.renderCoinRewardsPolicyView(policy, mint, { coinSummaryLaunch: appState.coinSummaryLaunch, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { getCoinMintAddress: appState.getCoinMintAddress, verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint });
  }
  // app-source-end

  // app-source: 928
  function compactCoinSocials(){
    return appState.compactCoinSocialsView({  }, {  });
  }
  // app-source-end

  // app-source: 930
  function sanitizeCoinRpcLabels(){
    const root = document.querySelector('#coin-page');
    if (!root) return;
    const replacements = [
      [/Confirmed Solana RPC snapshot/gi, 'Confirmed Solana snapshot'],
      [/Confirmed RPC snapshot/gi, 'Confirmed on-chain snapshot'],
      [/RPC confirmed/gi, 'Data confirmed'],
      [/Checking RPC/gi, 'Checking data'],
      [/RPC SNAPSHOT/gi, 'LIVE SNAPSHOT'],
      [/RPC trade scan if available/gi, 'Trade scan if available'],
      [/RPC trade history unavailable/gi, 'Trade history unavailable'],
      [/RPC only/gi, 'Solana data'],
      [/Solana RPC/gi, 'Solana'],
      [/from the current RPC scan/gi, 'from the current scan'],
      [/partial RPC scan/gi, 'partial scan'],
      [/Complete RPC scan/gi, 'Complete scan'],
      [/RPC coverage/gi, 'data coverage'],
      [/from Solana RPC/gi, 'from Solana'],
      [/\bRPC\b/gi, 'Solana data'],
    ];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const textNode of nodes) {
      let value = textNode.nodeValue;
      for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
      if (value !== textNode.nodeValue) textNode.nodeValue = value;
    }
  }
  // app-source-end

  // app-source: 931
  function startCoinLabelSanitizer(){
    if (appState.coinLabelObserver) return;
    const root = document.querySelector('#coin-page');
    if (!root || typeof MutationObserver === 'undefined') return;
    appState.coinLabelObserver = new MutationObserver(() => {
      appState.coinLabelObserver.disconnect();
      appState.sanitizeCoinRpcLabels();
      appState.coinLabelObserver.observe(root, { childList: true, subtree: true, characterData: true });
    });
    appState.coinLabelObserver.observe(root, { childList: true, subtree: true, characterData: true });
    appState.sanitizeCoinRpcLabels();
  }
  // app-source-end

  return { getCoinMintAddress, renderCoinCreatorRoute, renderCoinCreatorHeader, renderCoinRewardsPolicy, compactCoinSocials, sanitizeCoinRpcLabels, startCoinLabelSanitizer };
}
