import { paginateHistory } from '../../../history-pagination.js';
import { referralStatusLabel, referralClaimStatusLabel, isReferralSignInCancelled } from '../../../referral-status.js';
import { formatReferralLamports, readReferralHistory } from '../../../referral-amount.js';
// Dependencies and mutable application state are read live through appState.
export function createReferralsController(appState) {
  // app-source: 232
  function getAppReferralAttribution(){
    try {
      const attribution = JSON.parse(localStorage.getItem(appState.APP_REFERRAL_KEY) || 'null');
      const walletAddress = appState.connectedWalletAddress;
      if (!attribution?.code || !appState.normalizeReferralCode(attribution.code)) return null;
      if (attribution.wallet && walletAddress && attribution.wallet !== walletAddress) return null;
      return { ...attribution, code: appState.normalizeReferralCode(attribution.code) };
    } catch { return null; }
  }
  // app-source-end

  // app-source: 233
  function trackReferralEvent(event, detail = {}){
    try {
      const events = JSON.parse(localStorage.getItem(appState.REFERRAL_ANALYTICS_KEY) || '[]');
      events.push({ event, at: new Date().toISOString(), ...detail });
      localStorage.setItem(appState.REFERRAL_ANALYTICS_KEY, JSON.stringify(events.slice(-100)));
    } catch {}
  }
  // app-source-end

  // app-source: 234
  function captureAppReferral(){
    const query = new URLSearchParams(window.location.search);
    const code = query.get('ref')?.trim().toUpperCase();
    const attribution = appState.captureFirstTouch(appState.getAppReferralAttribution(), code, { ownCode: appState.getReferralCode() });
    if (!attribution) return appState.getAppReferralAttribution();
    if (!attribution.source && appState.normalizeReferralCode(code) === attribution.code) attribution.source = String(query.get('src') || 'direct').slice(0, 24);
    localStorage.setItem(appState.APP_REFERRAL_KEY, JSON.stringify(attribution));
    appState.trackReferralEvent('referral_captured');
    return attribution;
  }
  // app-source-end

  // app-source: 235
  function bindAppReferralToWallet(){
    const attribution = appState.getAppReferralAttribution();
    const walletAddress = appState.connectedWalletAddress;
    if (!attribution || !walletAddress) return;
    const bound = appState.bindReferralAttribution(attribution, walletAddress, appState.getReferralCode());
    if (bound) { localStorage.setItem(appState.APP_REFERRAL_KEY, JSON.stringify(bound)); appState.trackReferralEvent('wallet_bound'); }
    else localStorage.removeItem(appState.APP_REFERRAL_KEY);
  }
  // app-source-end

  // app-source: 236
  async function syncServerReferralState({ register = true } = {}){
    const session = appState.captureWalletSession();
    const walletAddress = session?.address;
    if (!session || session.provider.remoteMobile || typeof session.provider.signMessage !== 'function') return;
    try {
      await appState.ensureReferralSession(session, { interactive: true });
      const registrationKey = `${appState.REFERRAL_SERVER_KEY_PREFIX}${walletAddress}`;
      let registered = null;
      try { registered = JSON.parse(localStorage.getItem(registrationKey) || 'null'); } catch {}
      if (register && !registered?.code) {
        const prepared = await appState.apiRequest('/api/referrals/registration/prepare', { method: 'POST', body: { wallet: walletAddress } });
        if (!prepared.available) return;
        appState.assertWalletSessionCurrent(session);
        const verified = await appState.apiRequest('/api/referrals/registration/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, useWalletSession: true } });
        appState.assertWalletSessionCurrent(session);
        if (verified.data?.code) { registered = verified.data; localStorage.setItem(registrationKey, JSON.stringify(registered)); localStorage.setItem(`funded.app.referral.code.${walletAddress}`, registered.code); }
      }
      const attribution = appState.getAppReferralAttribution();
      if (attribution?.code && attribution.wallet === walletAddress && !attribution.serverVerified) {
        const prepared = await appState.apiRequest('/api/referrals/attribution/prepare', { method: 'POST', body: { wallet: walletAddress, code: attribution.code, source:attribution.source || 'direct' } });
        if (!prepared.available) return;
        appState.assertWalletSessionCurrent(session);
        await appState.apiRequest('/api/referrals/attribution/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, useWalletSession: true } });
        appState.assertWalletSessionCurrent(session);
        localStorage.setItem(appState.APP_REFERRAL_KEY, JSON.stringify({ ...attribution, serverVerified: true }));
        appState.trackReferralEvent('server_attribution_verified');
      }
    } catch (error) { appState.trackReferralEvent('server_referral_sync_failed', { reason: error.message }); throw error; }
  }
  // app-source-end

  // app-source: 237
  async function referralCodeForShare(){
    try {
      if (!appState.wallet) await appState.connectWallet();
      const session = appState.captureWalletSession();
      if (!session) throw new Error('Connect your wallet to share an invite.');
      await appState.syncServerReferralState();
      appState.assertWalletSessionCurrent(session);
      const registered = JSON.parse(localStorage.getItem(`${appState.REFERRAL_SERVER_KEY_PREFIX}${session.address}`) || 'null');
      const code = appState.normalizeReferralCode(registered?.code);
      if (!code) throw new Error('Invite link activation needs one wallet approval. Try again.');
      appState.updateReferralLink();
      return code;
    } catch (error) { appState.showToast(error.message || 'Invite link is unavailable.'); return ''; }
  }
  // app-source-end

  // app-source: 238
  async function ensureReferralSession(session, { interactive = false } = {}){
    if (!session?.address) throw new Error('Connect a wallet to view your referral dashboard.');
    const ready = await appState.walletSignIn.ensure(session, { interactive });
    appState.assertWalletSessionCurrent(session);
    appState.updateTokenChatComposerState();
    return ready;
  }
  // app-source-end

  // app-source: 239
function updateReferralStatus(state){
  const label = referralStatusLabel(state);
  document.documentElement.dataset.referralStatus = label;
  document.querySelectorAll('#referral-command-center .section-state').forEach(node => { node.textContent = label; });
  if (document.body.classList.contains('page-route-referrals')) { const node = document.querySelector('#route-guide-state'); if (node) node.textContent = label; }
}

  function clearReferralMetrics({ payouts = true, network = true } = {}){
    if (network) appState.renderShareInsights({ available:false });
    const values = { ...(payouts ? { 'referral-paid-total':'— SOL' } : {}),
      ...(network ? { 'referral-active-creators':'—', 'referral-conversion-rate':'—' } : {}) };
    for (const [id, value] of Object.entries(values)) {
      const node = document.querySelector(`#${id}`); if (node) node.textContent = value;
    }
  }


  function renderReferralClaimPrompt(title = 'Connect wallet to check referral rewards', note = 'Finalized creator-signed V3 payouts appear in your history.', approve = false){
    const panel = document.querySelector('#referral-claim-center');
    if (!panel) return;
    panel.hidden = false;
    const ledger = document.querySelector('#referral-ledger-list');
    if (ledger) ledger.hidden = true;
    panel.replaceChildren();
    const content = document.createElement('div');
    const eyebrow = document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'Referral payouts';
    const heading = document.createElement('strong'); heading.textContent = title;
    const detail = document.createElement('small'); detail.textContent = note;
    content.append(eyebrow, heading, detail); panel.append(content);
    if (approve) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Sign in with wallet';
      button.addEventListener('click', async () => { button.disabled = true; try { await appState.refreshReferralClaims({ interactive: true }); } finally { button.disabled = false; } });
      panel.append(button);
    } else if (!appState.captureWalletSession()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Connect wallet';
      button.addEventListener('click', () => document.querySelector('#connect-button')?.click()); panel.append(button);
    }
  }
  // app-source-end

  // app-source: 240
  function renderReferralLedgerEmpty(title, note){
    const ledger = document.querySelector('#referral-ledger-list');
    if (!ledger) return;
    const empty = document.createElement('div'); empty.className = 'empty-state referral-empty-state';
    const heading = document.createElement('strong'); heading.textContent = title;
    const detail = document.createElement('small'); detail.textContent = note;
    empty.append(heading, detail); ledger.replaceChildren(empty);
    paginateHistory(ledger, {label:'Referral history', selector:'.referral-ledger-row', key:appState.connectedWalletAddress});
  }
  // app-source-end

  // app-source: 241
  function renderReferralActivityEmpty(title, note){
    const empty = document.querySelector('#referral-activity-list .empty-state');
    if (!empty) return;
    empty.hidden = false;
    const heading = empty.querySelector('strong');
    const detail = empty.querySelector('small');
    if (heading && detail) { heading.textContent = title; detail.textContent = note; }
  }
  // app-source-end

  // app-source: 242
  async function refreshReferralClaims({ interactive = false } = {}){
    const session = appState.captureWalletSession();
    const walletAddress = session?.address; const dashboard = document.querySelector('#referral-command-center');
    if (!session || !dashboard) return;
    updateReferralStatus('checking');
    try {
      if (!await appState.ensureReferralSession(session, { interactive })) {
        if (appState.isWalletSessionCurrent(session)) {
          clearReferralMetrics();
          updateReferralStatus('verification');
          appState.renderReferralClaimPrompt('Sign in with wallet to view referral rewards', 'Approve one free sign-in message. Your session works across referrals and token discussions for one hour.', true);
          appState.renderReferralActivityEmpty('Wallet verification needed', 'Verify your wallet to check referral activity.');
          appState.renderReferralLedgerEmpty('Wallet verification needed', 'Verify your wallet to check payout receipts.');
        }
        return;
      }
    } catch (error) {
      if (appState.isWalletSessionCurrent(session)) {
        clearReferralMetrics();
        const cancelled = isReferralSignInCancelled(error);
        updateReferralStatus(cancelled ? 'cancelled' : 'unavailable');
        appState.renderReferralClaimPrompt(cancelled ? 'Wallet connected · sign-in cancelled' : 'Wallet connected · sign-in unavailable',
          cancelled ? 'The message was not signed. You can try again when ready. Signing in is free and does not move funds.' : 'We could not complete sign-in. Please try again shortly.', true);
        appState.renderReferralActivityEmpty('Sign in to see activity', 'Your wallet is connected. Sign in to view your private referral activity.');
        appState.renderReferralLedgerEmpty('Sign in to see receipts', 'Your wallet is connected. Sign in to view your reward history.');
      }
      return;
    }
    if (!appState.isWalletSessionCurrent(session)) return;
    const [result, dashboardResult] = await Promise.all([
      appState.apiRequest(`/api/referral-claims?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
      appState.apiRequest(`/api/referrals/dashboard?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
    ]);
    if (!appState.isWalletSessionCurrent(session)) return;
    appState.renderShareInsights(dashboardResult);
    if (dashboardResult.available) {
      const creators = Number(dashboardResult.data.networkCreators || 0);
      appState.renderReferralActivityEmpty(creators > 0 ? 'Network summary available' : 'No qualified activity yet', creators > 0
        ? `${creators} network creator${creators === 1 ? '' : 's'} reported. Individual activity is not available in this view.`
        : 'Qualified activity appears after verified fee collection is indexed.');
    } else { clearReferralMetrics({ payouts:false }); appState.renderReferralActivityEmpty('Activity unavailable', 'The referral dashboard could not be loaded. Try again later.'); }
    if (dashboardResult.available) { const active = document.querySelector('#referral-active-creators'); if (active) active.textContent = String(dashboardResult.data.qualifiedCreators ?? '—'); const conversion = document.querySelector('#referral-conversion-rate'); if (conversion) conversion.textContent = dashboardResult.data.conversionRate == null ? '—' : `${dashboardResult.data.conversionRate}%`; }
    const history = result.available ? readReferralHistory(result.data?.claims) : null;
    if (!history) { clearReferralMetrics({ network:false }); updateReferralStatus('unavailable'); appState.renderReferralClaimPrompt('Referral payout history unavailable', 'We cannot verify payout receipts right now. Try again later.'); appState.renderReferralLedgerEmpty('Receipts unavailable', 'Payout receipts could not be loaded. Try again later.'); return; }
    const claims = history.claims;
    updateReferralStatus(claims.length ? 'recorded' : 'ready');
    const paidLamports = history.paidLamports;
    const paidNode = document.querySelector('#referral-paid-total'); if (paidNode) paidNode.textContent = `${formatReferralLamports(paidLamports)} SOL`;
    const ledger = document.querySelector('#referral-ledger-list');
    if (ledger) { ledger.hidden = false; ledger.replaceChildren(); if (!claims.length) appState.renderReferralLedgerEmpty('No payouts yet', 'Finalized referral payouts will appear here after creator-approved settlement.'); }
    let panel = document.querySelector('#referral-claim-center');
    if (!panel) { panel = document.createElement('div'); panel.id = 'referral-claim-center'; panel.className = 'referral-dashboard'; panel.setAttribute('aria-live', 'polite'); dashboard.querySelector('.referral-kpi-grid')?.after(panel); }
    panel.replaceChildren(); panel.hidden = true;
    const note = document.querySelector('#referral-history-note');
    if (note) note.textContent = claims.some(claim => claim.status !== 'paid') ? 'Recorded allocations and finalized payouts. Only paid receipts count toward paid rewards.' : 'Creator-approved payouts are sent to your wallet. No manual claim is needed.';
    for (const claim of claims.slice().reverse()) {
      const row = document.createElement('div'); row.className = 'referral-ledger-row';
      const label = document.createElement('div'), level = document.createElement('strong'), status = document.createElement('small');
      level.textContent = `Level ${claim.level}`; status.textContent = referralClaimStatusLabel(claim.status); label.append(level, status);
      const amount = document.createElement('b'); amount.textContent = `${formatReferralLamports(claim.amountLamports || '0')} ${claim.asset}`;
      const actions = document.createElement('div'); actions.className = 'referral-receipt-actions'; row.append(label, amount, actions);
      if (claim.status === 'paid' && claim.payoutSignature) {
        const proof = document.createElement('a'); proof.textContent = 'Transaction ↗'; proof.title = claim.payoutSignature;
        proof.href = appState.exploreExplorer(`tx/${encodeURIComponent(claim.payoutSignature)}`);
        proof.target = '_blank'; proof.rel = 'noopener noreferrer'; actions.append(proof);
        if (BigInt(claim.amountLamports) > 0n) {
          const sharePaid = document.createElement('button'); sharePaid.type = 'button'; sharePaid.className = 'secondary-button'; sharePaid.textContent = 'Share receipt';
          sharePaid.addEventListener('click', async () => {
            sharePaid.disabled = true;
            try {
              const { PublicKey } = await appState.getSolana();
              const transaction = await appState.connection.getParsedTransaction(claim.payoutSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
              const keys = transaction?.transaction?.message?.accountKeys || [];
              const recipientIndex = keys.findIndex(entry => String(entry.pubkey || entry) === walletAddress);
              const before = transaction?.meta?.preBalances?.[recipientIndex];
              const after = transaction?.meta?.postBalances?.[recipientIndex];
              const router = String(appState.FEE_ROUTER_PROGRAM_ID || '');
              const routed = transaction?.transaction?.message?.instructions?.some(ix =>
                String(ix.programId || '') === String(router || ''));
              if (transaction?.meta?.err !== null || !routed || !Number.isSafeInteger(before)
                || !Number.isSafeInteger(after) || BigInt(after) - BigInt(before) !== BigInt(claim.amountLamports)
                || new PublicKey(walletAddress).toBase58() !== walletAddress)
                throw new Error('The finalized V3 payout transfer is not verified yet.');
              if (!appState.isWalletSessionCurrent(session)) return;
              const code = appState.registeredShareCode();
              appState.openShareComposer({ kind:'result', title:'Finalized referral payout on funded.vip', text:`My ${appState.EXPLORE_NETWORK_LABEL} referral payout of ${formatReferralLamports(claim.amountLamports)} SOL is finalized. Check the receipt on funded.vip.`, url: code ? appState.buildReferralUrl(code) : new URL('/#referrals', location.origin).toString(),
                result:{ verified:true, amount:Number(claim.amountLamports) / 1_000_000_000, asset:'SOL', receipt:claim.payoutSignature, receiptUrl:appState.exploreExplorer(`tx/${encodeURIComponent(claim.payoutSignature)}`), wallet:walletAddress, network:appState.EXPLORE_NETWORK_LABEL, period:'Finalized payout' } });
            } catch (error) { appState.showToast(error.message || 'Finalized payout verification is unavailable.'); }
            finally { sharePaid.disabled = false; }
          });
          actions.append(sharePaid);
        }
      }
      ledger?.append(row);
    }
    paginateHistory(ledger, {label:'Referral history', selector:'.referral-ledger-row', key:walletAddress});
  }
  // app-source-end

  // app-source: 243
  function getReferralCode(){
    const walletAddress = appState.connectedWalletAddress;
    if (!walletAddress) return '';
    const key = `funded.app.referral.code.${walletAddress}`;
    const saved = appState.normalizeReferralCode(localStorage.getItem(key));
    if (saved) return saved;
    const code = appState.createReferralCode();
    localStorage.setItem(key, code);
    return code;
  }
  // app-source-end

  // app-source: 244
  function updateReferralLink(){
    const code = appState.getReferralCode();
    const value = code ? appState.buildReferralUrl(code) : 'Connect wallet to generate';
    document.querySelectorAll('[data-referral-link]').forEach(node => { node.textContent = value; });
    let registered = null;
    try { registered = JSON.parse(localStorage.getItem(`${appState.REFERRAL_SERVER_KEY_PREFIX}${appState.connectedWalletAddress}`) || 'null'); } catch {}
    const status = document.querySelector('#referral-link-status'); if (status) status.textContent = !code ? 'Connect wallet' : registered?.code === code ? 'Ready to share' : 'Activate link when sharing';
    const copy = document.querySelector('#referral-command-center [data-copy-referral-link]');
    if (copy) copy.textContent = !code ? 'Get invite link' : registered?.code === code ? 'Copy link' : 'Activate invite link';
    const help = document.querySelector('#referral-share-help');
    if (help) help.textContent = registered?.code === code && code ? 'Invite creators with this link. Rewards depend on their collected and settled fees.' : 'Connect your wallet and approve a free sign-in message to activate your link.';
  }
  // app-source-end

  // app-source: 245
  function buildReferralUrl(code, source = ''){
    const url = new URL('/', window.location.origin);
    url.searchParams.set('ref', code);
    if (source) url.searchParams.set('src', source);
    return url.toString();
  }
  // app-source-end

  // app-source: 247
  function registeredShareCode(){
    if (!appState.connectedWalletAddress) return '';
    try {
      const registered = JSON.parse(localStorage.getItem(`${appState.REFERRAL_SERVER_KEY_PREFIX}${appState.connectedWalletAddress}`) || 'null');
      return appState.normalizeReferralCode(registered?.code);
    } catch { return ''; }
  }
  // app-source-end

  // app-source: 248
  function openCoinShare(mint, symbol = 'Coin', name = ''){
    if (!appState.validateSolanaMint(mint).valid) return appState.showToast('A valid token mint is required to share.');
    const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin);
    const code = appState.registeredShareCode();
    if (code) url.searchParams.set('ref', code);
    const label = String(name || symbol || 'Coin').trim().slice(0, 60);
    const verifiedName = !/^(token data unavailable|loading token)/i.test(label);
    appState.openShareComposer({ kind:'coin', title:`${verifiedName ? label : 'Token'} on funded.vip`, text: verifiedName
      ? `Explore ${label} on funded.vip. Review its ${appState.EXPLORE_NETWORK_LABEL} mint and market facts, then watch it for updates.`
      : `Open this ${appState.EXPLORE_NETWORK_LABEL} token record on funded.vip. Verify its data before relying on it.`, url:url.toString(), network:appState.EXPLORE_NETWORK_LABEL });
  }
  // app-source-end

  return { updateReferralStatus, getAppReferralAttribution, trackReferralEvent, captureAppReferral, bindAppReferralToWallet, syncServerReferralState, referralCodeForShare, ensureReferralSession, renderReferralClaimPrompt, renderReferralLedgerEmpty, renderReferralActivityEmpty, refreshReferralClaims, getReferralCode, updateReferralLink, buildReferralUrl, registeredShareCode, openCoinShare };
}
