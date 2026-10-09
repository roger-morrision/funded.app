import { Buffer } from 'buffer';
import bs58 from 'bs58';

const MOBILE_WALLET_SESSION_KEY = 'funded.app.phantom.mobile.session';

// Owns only the mobile relay and QR lifecycle. The app owns the active wallet.
export function createMobileWalletController({
  apiRequest, getSolana, getWallet, activateWallet, allowWalletReconnect,
  wasWalletManuallyDisconnected, closeDialog, showToast,
  window = globalThis.window, document = globalThis.document,
  sessionStorage = globalThis.sessionStorage, navigator = globalThis.navigator,
}) {
  let mobileWalletRequestVersion = 0;
  let mobileWalletLink = '';

  function mobileWalletHex(bytes){ return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); }
  async function registerMobileWalletFlow(signRequest = null, transactionRequest = null){
    const id = mobileWalletHex(24), pollToken = mobileWalletHex(32);
    const result = await apiRequest('/api/mobile-wallet/relay', { method:'POST', body:{ id, pollToken, ...(signRequest ? { signRequest } : {}), ...(transactionRequest ? { transactionRequest } : {}) } });
    if (!result.available) throw new Error('Wallet connection API is unavailable in this browser build.');
    if (!result.data?.callbackUrl || new URL(result.data.callbackUrl).origin !== window.location.origin) throw new Error('Wallet callback is unavailable on this app origin.');
    return { id, pollToken, callbackUrl:result.data.callbackUrl, expiresAt:Date.now() + 5 * 60_000 };
  }
  function showMobileWalletRequest(link, phase, qrLink = link){
    const dialog = document.querySelector('#mobile-wallet-dialog');
    const message = document.querySelector('#mobile-wallet-message');
    const qr = document.querySelector('#mobile-wallet-qr');
    const qrLabel = document.querySelector('#mobile-wallet-qr-label');
    const alternate = document.querySelector('#mobile-wallet-alternate');
    if (alternate) alternate.hidden = phase !== 'sign';
    dialog.querySelector('h2').textContent = phase === 'connect' ? 'Connect Phantom to this desktop' : phase === 'sign-fallback' ? 'Approve the message in Phantom' : phase === 'transaction' ? 'Review the Solana trade in Phantom' : 'Approve the claim in Phantom';
    const steps = dialog.querySelectorAll('.mobile-wallet-steps span');
    if (steps.length === 3) {
      steps[0].textContent = 'Scan this QR with Phantom on your phone';
      steps[1].textContent = phase === 'connect' ? 'Approve the Solana wallet connection' : phase === 'sign-fallback' ? 'Tap Connect and sign the message' : phase === 'transaction' ? 'Tap Connect and review, then approve the transaction' : 'Approve the claim message in Phantom';
      steps[2].textContent = phase === 'connect' ? 'Continue on this desktop; scan again when a claim needs signing' : phase === 'transaction' ? 'Return here for Solana confirmation' : 'Return to this desktop for payout verification';
    }
    mobileWalletLink = link;
    message.textContent = phase === 'connect' ? 'Scan with Phantom and approve this Solana wallet connection. The address will appear in this desktop tab.' : phase === 'sign-fallback' ? 'Scan with Phantom, then tap Connect and sign on the funded.vip signer page. The signature returns to this desktop tab.' : phase === 'transaction' ? 'This QR opens a small funded.vip signer inside Phantom. Review the amount, fee, and token there before approving. Your desktop wallet stays connected and submits the signed transaction.' : 'Scan with Phantom and approve the claim message. The signature will return to this desktop tab.';
    qr.src = `https://quickchart.io/qr?size=320&margin=2&text=${encodeURIComponent(qrLink)}`;
    qr.alt = phase === 'connect' ? 'Scan to connect Phantom mobile wallet to this desktop' : phase === 'sign-fallback' ? 'Scan to open funded.vip signer in Phantom' : phase === 'transaction' ? 'Scan to sign the Solana trade transaction with Phantom mobile wallet' : 'Scan to sign claim message with Phantom mobile wallet';
    qr.hidden = false;
    qrLabel.textContent = 'Waiting for approval in Phantom · expires in 5 minutes';
    if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
  }
  async function waitForMobileWalletFlow(flow, version){
    let temporaryFailures = 0;
    while (Date.now() < flow.expiresAt) {
      if (version !== mobileWalletRequestVersion || !document.querySelector('#mobile-wallet-dialog')?.open) throw new Error('Wallet request cancelled on desktop.');
      let response;
      try {
        response = await apiRequest(`/api/mobile-wallet/relay/${flow.id}`, { headers:{ 'x-mobile-wallet-token':flow.pollToken }, cache:'no-store' });
        temporaryFailures = 0;
      } catch (error) {
        if (/API request failed \((?:502|503|504)\)|Failed to fetch|API service unavailable/i.test(String(error.message))) {
          if (++temporaryFailures <= 5) { await new Promise(resolve => setTimeout(resolve, 1200)); continue; }
          throw new Error('Connection interrupted. Close this QR and start the wallet request again.');
        }
        if (/API request failed \(404\)/.test(String(error.message))) throw new Error('Wallet request expired. Close this QR and start the wallet request again.');
        throw error;
      }
      // Closing or replacing the QR while the poll is in flight invalidates its result.
      if (version !== mobileWalletRequestVersion || !document.querySelector('#mobile-wallet-dialog')?.open) throw new Error('Wallet request cancelled on desktop.');
      if (response.data?.status === 'complete') return response.data.result;
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    throw new Error('Phantom approval expired. Start a new wallet request.');
  }
  async function createMobileWalletProvider(session){
    const { verifyPhantomMobileSession, verifyPhantomMobileSignature, verifyPhantomMobileTransaction } = await import('../../../phantom-mobile-crypto.js');
    verifyPhantomMobileSession(session, window.location.origin);
    const { PublicKey } = await getSolana();
    let pendingTradeFlow = null;
    const provider = {
      publicKey:new PublicKey(session.publicKey), isConnected:true, remoteMobile:true,
      async signTransaction(transaction){
        if (!provider.isConnected) throw new Error('Reconnect the mobile wallet before trading.');
        const transactionRequest = { publicKey:session.publicKey, transaction:Buffer.from('message' in transaction ? transaction.serialize() : transaction.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64'), ...(Number.isSafeInteger(transaction.fundedLastValidBlockHeight) ? { lastValidBlockHeight:transaction.fundedLastValidBlockHeight } : {}), ...(transaction.fundedTradeSummary ? { summary:transaction.fundedTradeSummary } : {}), ...(transaction.fundedLaunchSummary ? { summary:transaction.fundedLaunchSummary } : {}) };
        const flow = await registerMobileWalletFlow(null, transactionRequest);
        pendingTradeFlow = flow;
        const version = ++mobileWalletRequestVersion;
        const signerUrl = `${window.location.origin}/api/mobile-wallet/trade/${flow.id}`;
        const browseLink = `https://phantom.app/ul/browse/${encodeURIComponent(signerUrl)}?ref=${encodeURIComponent(window.location.origin)}`;
        showMobileWalletRequest(browseLink, 'transaction');
        try {
          const result = await waitForMobileWalletFlow(flow, version);
          if (!Number.isSafeInteger(result.lastValidBlockHeight) || result.lastValidBlockHeight <= 0) throw new Error('Phantom returned a trade without a verified Solana expiry. Nothing was submitted.');
          const signed = verifyPhantomMobileTransaction(transaction, result.transaction, session.publicKey, result.blockhash);
          signed.fundedLastValidBlockHeight = result.lastValidBlockHeight;
          closeDialog('mobile-wallet-dialog');
          return signed;
        } catch (error) {
          const label = document.querySelector('#mobile-wallet-qr-label');
          if (label) label.textContent = error.message;
          throw error;
        }
      },
      async reportTradeSubmission(signature){
        if (!pendingTradeFlow) return;
        const flow = pendingTradeFlow;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await fetch(`/api/mobile-wallet/trade-status/${flow.id}`, { method:'POST', headers:{ 'content-type':'application/json', 'x-mobile-wallet-token':flow.pollToken }, body:JSON.stringify({ signature }) });
            if (response.ok) return;
          } catch { /* Retry a transient relay failure. */ }
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error('Could not update the phone with the Solana transaction signature.');
      },
      async signMessage(message){
        if (!provider.isConnected) throw new Error('Reconnect the mobile wallet before signing.');
        const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
        const statement = new TextDecoder('utf-8', { fatal:true }).decode(bytes);
        const flow = await registerMobileWalletFlow({ message:statement, publicKey:session.publicKey });
        const version = ++mobileWalletRequestVersion;
        const signerUrl = `${window.location.origin}/api/mobile-wallet/sign/${flow.id}`;
        const browseLink = `https://phantom.app/ul/browse/${encodeURIComponent(signerUrl)}?ref=${encodeURIComponent(window.location.origin)}`;
        showMobileWalletRequest(browseLink, 'sign-fallback');
        try {
          const signed = await waitForMobileWalletFlow(flow, version);
          const signature = verifyPhantomMobileSignature(bytes, signed.signature, session.publicKey);
          closeDialog('mobile-wallet-dialog');
          return { signature };
        } catch (error) { document.querySelector('#mobile-wallet-qr-label').textContent = error.message; throw error; }
      },
      async disconnect(){ provider.isConnected = false; sessionStorage.removeItem(MOBILE_WALLET_SESSION_KEY); },
    };
    return provider;
  }
  async function openMobileWalletDialog(){
    if (window.location.protocol !== 'https:') { showToast('Use the hosted HTTPS site to connect Phantom on your phone.'); return; }
    try {
      const [{ default: nacl }, { decryptPhantomMobileResult, verifyPhantomMobileSession }] = await Promise.all([import('tweetnacl'), import('../../../phantom-mobile-crypto.js')]);
      const flow = await registerMobileWalletFlow();
      const version = ++mobileWalletRequestVersion;
      const keyPair = nacl.box.keyPair();
      const link = new URL('https://phantom.app/ul/v1/connect');
      link.search = new URLSearchParams({ app_url:window.location.origin, dapp_encryption_public_key:bs58.encode(keyPair.publicKey), redirect_link:flow.callbackUrl, cluster:'devnet' }).toString();
      showMobileWalletRequest(link.toString(), 'connect');
      const result = await waitForMobileWalletFlow(flow, version);
      if (result.errorCode) throw new Error(result.errorMessage || 'Phantom connection was cancelled.');
      if (!result.phantom_encryption_public_key || bs58.decode(result.phantom_encryption_public_key).length !== 32) throw new Error('Phantom did not return an encryption key.');
      const sharedSecret = nacl.box.before(bs58.decode(result.phantom_encryption_public_key), keyPair.secretKey);
      const approved = decryptPhantomMobileResult(result, sharedSecret);
      const session = verifyPhantomMobileSession({ publicKey:approved.public_key, session:approved.session, secretKey:bs58.encode(keyPair.secretKey), phantomPublicKey:result.phantom_encryption_public_key }, window.location.origin);
      const provider = await createMobileWalletProvider(session);
      sessionStorage.setItem(MOBILE_WALLET_SESSION_KEY, JSON.stringify(session));
      allowWalletReconnect();
      activateWallet(provider, 'Phantom mobile wallet connected');
      closeDialog('mobile-wallet-dialog');
      showToast('Phantom wallet connected on desktop');
    } catch (error) { const label=document.querySelector('#mobile-wallet-qr-label'); if(label?.closest('dialog')?.open)label.textContent=error.message; showToast(error.message || 'Phantom connection failed.'); }
  }
  async function restoreMobileWallet(){
    if (getWallet() || wasWalletManuallyDisconnected()) return false;
    try { const stored=JSON.parse(sessionStorage.getItem(MOBILE_WALLET_SESSION_KEY)||'null'); if(!stored)return false; activateWallet(await createMobileWalletProvider(stored), 'Phantom mobile wallet restored'); return true; }
    catch { try { sessionStorage.removeItem(MOBILE_WALLET_SESSION_KEY); } catch { /* Storage may also prevent cleanup; no session was restored. */ } return false; }
  }
  function cancel() {
    mobileWalletRequestVersion++;
    closeDialog('mobile-wallet-dialog');
  }

  async function copyLink() {
    if (!mobileWalletLink) return;
    try { await navigator.clipboard.writeText(mobileWalletLink); showToast('Phantom request link copied'); }
    catch { showToast('Could not copy the Phantom request link.'); }
  }

  return { open: openMobileWalletDialog, restore: restoreMobileWallet, cancel, copyLink };
}
