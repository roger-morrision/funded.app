import { paginateHistory } from '../../../history-pagination.js';
import { referralStatusLabel, referralClaimStatusLabel } from '../../../referral-status.js';
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
      const registrationKey = `${appState.REFERRAL_SERVER_KEY_PREFIX}${walletAddress}`;
      let registered = null;
      try { registered = JSON.parse(localStorage.getItem(registrationKey) || 'null'); } catch {}
      if (register && !registered?.code) {
        const prepared = await appState.apiRequest('/api/referrals/registration/prepare', { method: 'POST', body: { wallet: walletAddress } });
        if (!prepared.available) return;
        appState.assertWalletSessionCurrent(session);
        const signature = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
        appState.assertWalletSessionCurrent(session);
        const verified = await appState.apiRequest('/api/referrals/registration/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, signature: appState.bs58.encode(signature) } });
        appState.assertWalletSessionCurrent(session);
        if (verified.data?.code) { registered = verified.data; localStorage.setItem(registrationKey, JSON.stringify(registered)); localStorage.setItem(`funded.app.referral.code.${walletAddress}`, registered.code); }
      }
      const attribution = appState.getAppReferralAttribution();
      if (attribution?.code && attribution.wallet === walletAddress && !attribution.serverVerified) {
        const prepared = await appState.apiRequest('/api/referrals/attribution/prepare', { method: 'POST', body: { wallet: walletAddress, code: attribution.code, source:attribution.source || 'direct' } });
        if (!prepared.available) return;
        appState.assertWalletSessionCurrent(session);
        const signature = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
        appState.assertWalletSessionCurrent(session);
        await appState.apiRequest('/api/referrals/attribution/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, signature: appState.bs58.encode(signature) } });
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
    const current = await appState.apiRequest('/api/referrals/session').catch(() => null);
    appState.assertWalletSessionCurrent(session);
    if (current?.data?.authenticated && current.data.wallet === session.address) return true;
    if (!interactive) return false;
    if (typeof session.provider?.signMessage !== 'function') throw new Error('Connect a wallet that can approve referral dashboard access.');
    const prepared = await appState.apiRequest('/api/referrals/session/prepare', { method:'POST', body:{ wallet:session.address } });
    appState.assertWalletSessionCurrent(session);
    const signed = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
    appState.assertWalletSessionCurrent(session);
    const verified = await appState.apiRequest('/api/referrals/session/verify', { method:'POST', body:{ challengeId:prepared.data.challengeId, wallet:session.address, signature:appState.bs58.encode(signed.signature || signed) } });
    if (!verified.data?.authenticated || verified.data.wallet !== session.address) throw new Error('Referral dashboard approval failed.');
    return true;
  }
  // app-source-end

  // app-source: 239
function updateReferralStatus(state, claimable = 0){
  const label = referralStatusLabel(state, claimable);
  document.documentElement.dataset.referralStatus = label;
  document.querySelectorAll('#referral-command-center .section-state, #referral-total-claimable + small').forEach(node => { node.textContent = label; });
  if (document.body.classList.contains('page-route-referrals')) { const node = document.querySelector('#route-guide-state'); if (node) node.textContent = label; }
}


  function renderReferralClaimPrompt(title = 'Connect wallet to check claimable referral rewards', note = 'Each available reward requires a wallet signature and a separate payout action.', approve = false){
    const panel = document.querySelector('#referral-claim-center');
    if (!panel) return;
    panel.replaceChildren();
    const content = document.createElement('div');
    const eyebrow = document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'Manual rewards';
    const heading = document.createElement('strong'); heading.textContent = title;
    const detail = document.createElement('small'); detail.textContent = note;
    content.append(eyebrow, heading, detail); panel.append(content);
    if (approve) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Verify wallet to view';
      button.addEventListener('click', async () => { button.disabled = true; try { await appState.refreshReferralClaims({ interactive: true }); } finally { button.disabled = false; } });
      panel.append(button);
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
          updateReferralStatus('verification');
          appState.renderReferralClaimPrompt('Verify wallet to view referral rewards', 'Your private referral dashboard needs one wallet approval. Refreshing this page will not request a signature.', true);
          appState.renderReferralActivityEmpty('Wallet verification needed', 'Verify your wallet to check referral activity.');
          appState.renderReferralLedgerEmpty('Wallet verification needed', 'Verify your wallet to check claim receipts.');
        }
        return;
      }
    } catch (error) { if (appState.isWalletSessionCurrent(session)) { updateReferralStatus('unavailable'); appState.renderReferralClaimPrompt('Referral dashboard unavailable', error.message || 'Try verifying your wallet again.', true); appState.renderReferralActivityEmpty('Access unavailable', 'Verify your wallet to check referral activity.'); appState.renderReferralLedgerEmpty('Access unavailable', 'Verify your wallet to check claim receipts.'); } return; }
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
    } else appState.renderReferralActivityEmpty('Activity unavailable', 'The referral dashboard could not be loaded. Try again later.');
    if (!result.available) { updateReferralStatus('unavailable'); appState.renderReferralClaimPrompt('Referral claim service unavailable', 'No reward action is available until the claim service can be verified.'); appState.renderReferralLedgerEmpty('Receipts unavailable', 'The claim service could not be verified. Try again later.'); return; }
    if (dashboardResult.available) { const active = document.querySelector('#referral-active-creators'); if (active) active.textContent = String(dashboardResult.data.networkCreators ?? '—'); const conversion = document.querySelector('#referral-conversion-rate'); if (conversion) conversion.textContent = dashboardResult.data.conversionRate == null ? '—' : `${dashboardResult.data.conversionRate}%`; }
    const claims = Array.isArray(result.data.claims) ? result.data.claims : [];
    const claimable = claims.filter(claim => ['awaiting-wallet-signature', 'wallet-verified'].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
    updateReferralStatus('ready', claimable);
    const paid = claims.filter(claim => claim.status === 'paid').reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
    const claimableNode = document.querySelector('#referral-total-claimable'); if (claimableNode) claimableNode.textContent = `${claimable.toFixed(4)} SOL`;
    const paidNode = document.querySelector('#referral-paid-total'); if (paidNode) paidNode.textContent = `${paid.toFixed(4)} SOL`;
    const ledger = document.querySelector('#referral-ledger-list');
    if (ledger) { ledger.replaceChildren(); if (!claims.length) appState.renderReferralLedgerEmpty('No receipts yet', 'Finalized referral claims will appear here.'); else claims.slice().reverse().forEach(claim => { const row = document.createElement('div'); row.className = 'referral-ledger-row'; const label = document.createElement('strong'); label.textContent = `Level ${claim.level}`; const status = document.createElement('small'); status.textContent = referralClaimStatusLabel(claim.status); const amount = document.createElement('b'); amount.textContent = `${Number(claim.amount || 0).toFixed(4)} ${claim.asset}`; row.append(label, status, amount); ledger.append(row); }); }
    paginateHistory(ledger, {label:'Referral history', selector:'.referral-ledger-row', key:walletAddress});
    let panel = document.querySelector('#referral-claim-center');
    if (!panel) { panel = document.createElement('div'); panel.id = 'referral-claim-center'; panel.className = 'referral-dashboard'; panel.setAttribute('aria-live', 'polite'); dashboard.querySelector('.referral-kpi-grid')?.after(panel); }
    panel.replaceChildren();
    const heading = document.createElement('div'); const title = document.createElement('strong'); title.textContent = 'Referral claim center'; const note = document.createElement('small'); note.textContent = claims.length ? 'Rewards require your wallet signature and a separate payout action.' : 'No claimable referral rewards yet.'; heading.append(title, note); panel.append(heading);
    for (const claim of result.data.claims) {
      const row = document.createElement('div'); row.className = 'referral-claim-row'; const label = document.createElement('span'); label.textContent = `Level ${claim.level} · ${claim.amount} ${claim.asset} · ${referralClaimStatusLabel(claim.status)}`; row.append(label);
      if (claim.status === 'awaiting-wallet-signature' && session.provider.signMessage) { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Sign claim'; button.onclick = async () => { button.disabled = true; try { appState.assertWalletSessionCurrent(session); const signature = await session.provider.signMessage(new TextEncoder().encode(claim.statement)); appState.assertWalletSessionCurrent(session); await appState.apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/verify`, { method: 'POST', body: { publicKey: walletAddress, signature: appState.bs58.encode(signature) } }); if (appState.isWalletSessionCurrent(session)) await appState.refreshReferralClaims(); } catch (error) { if (appState.isWalletSessionCurrent(session)) { appState.showToast(error.message); button.disabled = false; } } }; row.append(button); }
      if (claim.status === 'wallet-verified') { const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.textContent = 'Receive SOL'; button.onclick = async () => { button.disabled = true; try { appState.assertWalletSessionCurrent(session); await appState.apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/execute`, { method: 'POST' }); if (appState.isWalletSessionCurrent(session)) { appState.showToast('Referral reward paid'); await appState.refreshReferralClaims(); } } catch (error) { if (appState.isWalletSessionCurrent(session)) { appState.showToast(error.message); button.disabled = false; } } }; row.append(button); }
      if (claim.status === 'paid' && claim.payoutSignature) {
        const receipt = document.createElement('small'); receipt.textContent = `Paid · ${claim.payoutSignature}`; row.append(receipt);
        if (claim.asset === 'SOL' && Number(claim.amount) > 0) {
          const sharePaid = document.createElement('button'); sharePaid.type = 'button'; sharePaid.className = 'secondary-button'; sharePaid.textContent = 'Share receipt card';
          sharePaid.addEventListener('click', async () => {
            sharePaid.disabled = true;
            try {
              const { PublicKey } = await appState.getSolana();
              const transaction = await appState.connection.getParsedTransaction(claim.payoutSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
              const expectedLamports = Math.floor(Number(claim.amount) * 1_000_000_000);
              const matchingTransfer = transaction?.transaction?.message?.instructions?.some(instruction => instruction.program === 'system'
                && instruction.parsed?.type === 'transfer' && instruction.parsed.info?.destination === walletAddress
                && Number(instruction.parsed.info?.lamports) === expectedLamports);
              if (transaction?.meta?.err !== null || !matchingTransfer || new PublicKey(walletAddress).toBase58() !== walletAddress) throw new Error('The finalized payout transfer is not verified yet.');
              if (!appState.isWalletSessionCurrent(session)) return;
              const code = appState.registeredShareCode();
              appState.openShareComposer({ kind:'result', title:'Finalized referral payout on funded.vip', text:`My ${appState.EXPLORE_NETWORK_LABEL} referral payout of ${Number(claim.amount).toFixed(4)} SOL is finalized. Check the receipt on funded.vip.`, url: code ? appState.buildReferralUrl(code) : new URL('/#referrals', location.origin).toString(),
                result:{ verified:true, amount:Number(claim.amount), asset:'SOL', receipt:claim.payoutSignature, receiptUrl:appState.exploreExplorer(`tx/${encodeURIComponent(claim.payoutSignature)}`), wallet:walletAddress, network:appState.EXPLORE_NETWORK_LABEL, period:'Finalized payout' } });
            } catch (error) { appState.showToast(error.message || 'Finalized payout verification is unavailable.'); }
            finally { sharePaid.disabled = false; }
          });
          row.append(sharePaid);
        }
      }
      panel.append(row);
    }
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
