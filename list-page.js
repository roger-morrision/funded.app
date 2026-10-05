import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAccount, getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import { apiRequest } from './client.js';
import { waitForSignatureConfirmation } from './funded-burn.js';
import { LISTING_BURN_TOKENS, LISTING_DEVNET_GENESIS_HASH, listingBurnBaseUnits, listingMemo } from './listing-policy.js';
import { canSignTransactions } from './wallet-core.js';
import { readPendingListing, savePendingListing, clearPendingListing } from './listing-recovery.js';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const byId = id => document.getElementById(id);

export function initPaidListing({ getSolana, getConnection, getSession, assertSession, connectWallet, cluster, fundedMint, mainnetReadOnly }) {
  const mintInput = byId('list-mint');
  if (!mintInput) return;
  const nameInput = byId('list-name');
  const symbolInput = byId('list-symbol');
  const detailFields = document.querySelector('.list-token-fields');
  const detailNote = document.querySelector('.list-field-note');
  const preview = byId('list-token-preview');
  const help = byId('list-mint-help');
  const availability = byId('list-availability');
  const status = byId('list-payment-status');
  const payButton = byId('list-pay');
  const review = byId('list-review');
  const recovery = byId('list-recovery');
  const live = byId('list-live-items');
  let config = null;
  let listings = [];
  let listingsAvailable = false;
  let busy = false;
  let prepared = null;
  let lookup = null;
  let lookupSequence = 0;
  let lookupTimer = null;
  let recoveryError = '';
  let pendingNotice = null;
  let retainedPending = null;
  function readPending() {
    try {
      const pending = readPendingListing();
      if (retainedPending && JSON.stringify(pending) !== JSON.stringify(retainedPending)) throw new Error('Saved listing recovery changed or disappeared. The original signed receipt is retained in this tab; do not submit another burn.');
      if (pending) retainedPending = pending;
      recoveryError = ''; return pending;
    }
    catch (error) { recoveryError = error.message || 'Listing recovery storage is unavailable. Do not submit another burn.'; return retainedPending; }
  }
  function setPendingStatus(message, pending) {
    pendingNotice = { signature: pending.signature, message };
    setStatus(message, pending.signature);
  }
  function sessionCurrent(session) {
    try { assertSession(session); return true; } catch { return false; }
  }

  const configuredBurnTokens = () => {
    const amount = Number(config?.burnTokens);
    return Number.isSafeInteger(amount) && amount > 0 && amount <= Number(LISTING_BURN_TOKENS) ? amount : null;
  };
  const burnLabel = () => (configuredBurnTokens() || Number(LISTING_BURN_TOKENS)).toLocaleString('en-US');
  const burnTokenNoun = () => configuredBurnTokens() === 1 ? 'token' : 'tokens';
  function renderBurnCopy() {
    const label = burnLabel();
    const step = byId('list-burn-step-copy');
    const disclosure = byId('list-burn-disclosure');
    const reviewCopy = byId('list-review-copy');
    const reviewPayment = byId('list-review-payment');
    if (step) step.textContent = `Approve an irreversible ${label} $FUNDED BurnChecked transaction. The same transaction binds the payment to this mint.`;
    if (disclosure) disclosure.textContent = `Burns permanently reduce $FUNDED supply. The fee is ${label} ${burnTokenNoun()}, not a fixed USD value. A wallet approval and verified receipt are required before a listing appears.`;
    if (reviewCopy) reviewCopy.textContent = `Burning ${label} $FUNDED is permanent. The transaction will bind this payment to the token mint below. The listing appears after the server verifies the finalized burn and token metadata.`;
    if (reviewPayment) reviewPayment.textContent = `${label} $FUNDED · BurnChecked`;
  }

  function mintValue() {
    try { return new PublicKey(mintInput.value.trim()).toBase58(); } catch { return null; }
  }
  function setStatus(message, signature = '') {
    status.replaceChildren(document.createTextNode(message));
    if (signature) {
      const link = document.createElement('a');
      link.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ' View burn proof ↗';
      status.append(link);
    }
  }
  function draw() {
    const mint = mintValue();
    const value = mintInput.value.trim();
    const verified = mint && lookup?.mint === mint && lookup.status === 'verified';
    const pending = readPending();
    if (detailFields) detailFields.hidden = true;
    if (detailNote) detailNote.hidden = true;
    if (status) status.hidden = !verified && !pending && !recoveryError;
    mintInput.removeAttribute('aria-invalid');
    help.classList.remove('is-valid', 'is-invalid');
    if (!value) help.textContent = 'Enter a Solana mint to check its address format.';
    else if (!mint) { help.textContent = 'Enter a valid Solana mint address.'; help.classList.add('is-invalid'); mintInput.setAttribute('aria-invalid', 'true'); }
    else { help.textContent = 'Valid address format. The token mint will be checked on Solana before payment.'; help.classList.add('is-valid'); }
    const existing = mint && listings.find(item => item.mint === mint);
    preview.hidden = !mint;
    preview.replaceChildren();
    if (mint) {
      const title = document.createElement('strong');
      const note = document.createElement('small');
      if (verified) {
        title.textContent = lookup.name;
        note.textContent = `${lookup.symbol} · Verified Solana token metadata`;
        if (existing) {
          const link = document.createElement('a');
          link.href = `/token/${encodeURIComponent(mint)}`;
          link.textContent = 'Already listed ↗';
          preview.append(title, note, link);
        } else preview.append(title, note);
      } else {
        title.textContent = lookup?.mint === mint && lookup.status === 'error' ? 'Token lookup unavailable' : 'Checking token metadata…';
        note.textContent = lookup?.mint === mint && lookup.status === 'error'
          ? `${lookup.message} No listing payment can be reviewed.`
          : 'Reading the mint and signed metadata from Solana.';
        preview.append(title, note);
      }
    }
    if (payButton) payButton.hidden = !verified || Boolean(existing);
    recovery.hidden = !pending && !recoveryError;
    byId('list-retry').disabled = busy || !pending || Boolean(recoveryError);
    const amountTokens = configuredBurnTokens();
    const ready = listingsAvailable && config?.enabled === true && config.cluster === 'devnet' && config.fundedMint === fundedMint
      && amountTokens != null && cluster === 'devnet' && !mainnetReadOnly;
    renderBurnCopy();
    availability.textContent = ready ? `${burnLabel()} $FUNDED · Devnet` : 'Payment unavailable';
    payButton.disabled = !ready || !verified || busy || Boolean(existing) || Boolean(pending) || Boolean(recoveryError);
    payButton.textContent = busy ? 'Processing…' : pending ? 'Resolve pending burn first' : existing ? 'Already listed' : ready ? `Review ${burnLabel()} $FUNDED burn` : 'Listing unavailable';
    if (recoveryError) setStatus(recoveryError, pending?.signature);
    else if (pending) setStatus(pendingNotice?.signature === pending.signature ? pendingNotice.message
      : 'A signed burn is saved in this tab. Verify its original receipt before another payment; submission may be unconfirmed.', pending.signature);
    else if (existing) setStatus('Listing burn verified.', existing.signature);
  }
  function queueLookup() {
    const sequence = ++lookupSequence;
    clearTimeout(lookupTimer);
    const mint = mintValue();
    nameInput.value = '';
    symbolInput.value = '';
    lookup = mint ? { mint, status:'pending' } : null;
    setStatus(mint ? 'Checking verified Solana token metadata before payment.' : 'Enter a mint to check listing availability.');
    draw();
    if (!mint) return;
    const existing = listings.find(item => item.mint === mint && item.onchainVerified === true && item.cluster === 'devnet');
    if (existing?.name && existing?.symbol) {
      lookup = { mint, status:'verified', name:existing.name, symbol:existing.symbol };
      nameInput.value = existing.name;
      symbolInput.value = existing.symbol;
      draw();
      return;
    }
    lookupTimer = setTimeout(async () => {
      try {
        const result = await apiRequest(`/api/listings/mint/${encodeURIComponent(mint)}`, { signal:AbortSignal.timeout(12000) });
        if (sequence !== lookupSequence || mint !== mintValue()) return;
        if (!result.available || result.data?.cluster !== 'devnet' || result.data.mint !== mint
          || !result.data.name || !result.data.symbol) throw new Error('Verified token metadata is unavailable.');
        lookup = { mint, status:'verified', name:result.data.name, symbol:result.data.symbol };
        nameInput.value = lookup.name;
        symbolInput.value = lookup.symbol;
        setStatus('Token metadata verified on Solana. Review remains gated by listing availability and wallet checks.');
      } catch (error) {
        if (sequence !== lookupSequence || mint !== mintValue()) return;
        lookup = { mint, status:'error', message:error instanceof TypeError ? 'Solana metadata service unavailable.' : error.message || 'The Solana metadata service did not respond.' };
        setStatus('Token metadata could not be verified. No listing payment can be reviewed.');
      }
      draw();
    }, 250);
  }
  function renderListings() {
    if (!live) return;
    live.replaceChildren();
    if (!listings.length) { const empty = document.createElement('p'); empty.textContent = 'No paid listings have been verified on Solana yet.'; live.append(empty); return; }
    for (const item of listings) {
      const row = document.createElement('a'); row.href = `/token/${encodeURIComponent(item.mint)}`; row.setAttribute('role', 'listitem');
      const title = document.createElement('strong'); title.textContent = `${item.name} · ${item.symbol}`;
      const mint = document.createElement('code'); mint.textContent = item.mint;
      const amount = Number(item.amountTokens);
      const amountLabel = Number.isSafeInteger(amount) && amount > 0 ? amount.toLocaleString('en-US') : burnLabel();
      const note = document.createElement('small'); note.textContent = `${amountLabel} $FUNDED burn finalized · token name and ticker verified`;
      row.append(title, mint, note); live.append(row);
    }
  }
  async function refreshListings() {
    try {
      const result = await apiRequest('/api/listings', { signal: AbortSignal.timeout(8000) });
      if (!result.available || result.data?.cluster !== 'devnet' || !Array.isArray(result.data.listings)) throw new Error('Listing index unavailable.');
      listings = result.data.listings;
      listingsAvailable = true;
      const pending = readPending();
      if (pending && listings.some(item => item.mint === pending.mint && item.signature === pending.signature
        && item.onchainVerified === true && item.cluster === 'devnet' && (item.wallet == null || item.wallet === pending.wallet))) {
        try { clearPendingListing(pending); retainedPending = null; pendingNotice = null; }
        catch (error) { setPendingStatus(`Listing receipt verified, but recovery cleanup is incomplete: ${error.message}`, pending); }
      }
      renderListings();
      if (mintValue() && listings.some(item => item.mint === mintValue() && item.onchainVerified === true)) queueLookup();
      else draw();
      return true;
    } catch { listings = []; listingsAvailable = false; live.textContent = 'The verified listing index is unavailable.'; setStatus('The public listing index is unavailable. Payment is paused.'); draw(); return false; }
  }
  async function refreshConfig() {
    try {
      const result = await apiRequest('/api/listings/config', { signal: AbortSignal.timeout(8000) });
      config = result.available ? result.data : null;
      const pending = readPending();
      setStatus(pending ? 'A prior burn is awaiting receipt verification. Retry the receipt before another payment.'
        : config?.enabled ? 'Enter a mint, name, and ticker to review the burn.' : 'Listing payments are unavailable until the Solana API and $FUNDED mint are configured.', pending?.signature);
    } catch { config = null; setStatus('Listing payment service unavailable. No burn can be submitted.'); }
    draw();
  }
  async function preparePayment() {
    if (payButton.disabled) return;
    busy = true; draw();
    try {
      if (readPending() || recoveryError) throw new Error(recoveryError || 'Verify the saved signed burn before another payment.');
      if (!await refreshListings()) throw new Error('The public listing index is unavailable. Payment is paused.');
      if (listings.some(item => item.mint === mintValue())) throw new Error('This mint is already listed. No new payment is needed.');
      let session = getSession();
      if (!session) { await connectWallet(); session = getSession(); }
      if (!session || !canSignTransactions(session.provider)) throw new Error('Connect a signing Solana wallet to continue.');
      await getSolana();
      const rpc = getConnection();
      if (await rpc.getGenesisHash() !== LISTING_DEVNET_GENESIS_HASH) throw new Error('Wallet RPC failed verification. No burn was submitted.');
      const mint = new PublicKey(mintInput.value.trim()).toBase58();
      const mintAccount = await rpc.getAccountInfo(new PublicKey(mint), 'finalized');
      if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)))
        throw new Error('This mint is not a supported SPL token on Solana.');
      const listingMetadata = await apiRequest(`/api/listings/mint/${encodeURIComponent(mint)}`, { signal:AbortSignal.timeout(12000) });
      if (!listingMetadata.available || listingMetadata.data?.mint !== mint || listingMetadata.data?.cluster !== 'devnet'
        || !listingMetadata.data?.name || !listingMetadata.data?.symbol)
        throw new Error('Verified token metadata is unavailable. No burn was submitted.');
      if (nameInput.value.trim() !== listingMetadata.data.name || symbolInput.value.trim() !== listingMetadata.data.symbol)
        throw new Error(`Use the verified token name and ticker: ${listingMetadata.data.name} (${listingMetadata.data.symbol}). No burn was submitted.`);
      const fundedKey = new PublicKey(fundedMint);
      const fundedAccount = await rpc.getAccountInfo(fundedKey, 'confirmed');
      if (!fundedAccount || (!fundedAccount.owner.equals(TOKEN_PROGRAM_ID) && !fundedAccount.owner.equals(TOKEN_2022_PROGRAM_ID)))
        throw new Error('The configured $FUNDED mint is unavailable on Solana.');
      const tokenProgram = fundedAccount.owner;
      const funded = await getMint(rpc, fundedKey, 'confirmed', tokenProgram);
      const amountTokens = configuredBurnTokens();
      if (amountTokens == null) throw new Error('The Solana listing burn policy is unavailable.');
      const amount = listingBurnBaseUnits(funded.decimals, amountTokens);
      const accounts = await rpc.getTokenAccountsByOwner(new PublicKey(session.address), { mint: fundedKey }, 'confirmed');
      const source = accounts.value.map(row => ({ address: row.pubkey, amount: unpackAccount(row.pubkey, row.account, tokenProgram).amount }))
        .find(row => row.amount >= amount);
      if (!source) throw new Error(`This wallet needs ${burnLabel()} $FUNDED in one token account to list this mint.`);
      assertSession(session);
      prepared = { session, rpc, mint, name: nameInput.value.trim(), symbol: symbolInput.value.trim(),
        fundedKey, tokenProgram, decimals: funded.decimals, amountTokens, amount, source, supplyBefore: funded.supply };
      byId('list-review-mint').textContent = mint;
      byId('list-review-wallet').textContent = session.address;
      review.showModal();
      setStatus('Review the exact Solana burn before asking your wallet to sign.');
    } catch (error) { setStatus(error.message || 'Listing review is unavailable.'); }
    finally { busy = false; draw(); }
  }
  async function claimPending(pending = readPending()) {
    if (busy || !pending || recoveryError) return;
    busy = true; draw();
    try {
      const result = await apiRequest('/api/listings', { method: 'POST', body: pending, signal: AbortSignal.timeout(20000) });
      if (!result.available || result.data?.mint !== pending.mint || result.data?.signature !== pending.signature || result.data?.onchainVerified !== true
        || result.data?.cluster !== 'devnet' || (result.data.wallet != null && result.data.wallet !== pending.wallet))
        throw new Error('The receipt was not confirmed by the listing index.');
      try { clearPendingListing(pending); retainedPending = null; pendingNotice = null; }
      catch (error) { retainedPending = pending; setPendingStatus(`Listing receipt verified, but recovery cleanup is incomplete: ${error.message}`, pending); return; }
      setStatus('Listing verified and live in Launch Directory.', pending.signature);
      await refreshListings();
      window.dispatchEvent(new Event('funded:listing-verified'));
    } catch (error) { setPendingStatus(`Signed burn receipt verification is pending: ${error.message} Do not submit another burn.`, pending); }
    finally { busy = false; draw(); }
  }
  async function submitPayment() {
    const payment = prepared; prepared = null; review.close();
    if (!payment) return;
    busy = true; draw();
    let signature = '';
    let confirmedFailure = false;
    let broadcastStarted = false;
    let pending = null;
    try {
      assertSession(payment.session);
      if (readPending() || recoveryError) throw new Error(recoveryError || 'Verify the saved signed burn before another payment.');
      if (mintInput.value.trim() !== payment.mint || nameInput.value.trim() !== payment.name || symbolInput.value.trim() !== payment.symbol)
        throw new Error('Listing details changed. Review the payment again.');
      const latest = await payment.rpc.getLatestBlockhash('confirmed');
      assertSession(payment.session);
      const transaction = new Transaction({ feePayer: payment.session.provider.publicKey, recentBlockhash: latest.blockhash }).add(
        createBurnCheckedInstruction(payment.source.address, payment.fundedKey, payment.session.provider.publicKey,
          payment.amount, payment.decimals, [], payment.tokenProgram),
        new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(listingMemo(payment.mint), 'utf8') }),
      );
      setStatus(`Review the irreversible ${Number(payment.amountTokens).toLocaleString('en-US')} $FUNDED burn in your wallet.`);
      const signed = await payment.session.provider.signTransaction(transaction);
      assertSession(payment.session);
      const raw = signed.serialize();
      const signedIdentity = Transaction.from(raw).signature;
      if (!signedIdentity || signedIdentity.length !== 64) throw new Error('The wallet did not return a valid signed transaction.');
      signature = bs58.encode(signedIdentity);
      pending = { mint: payment.mint, name: payment.name, symbol: payment.symbol, wallet: payment.session.address, signature, cluster: 'devnet' };
      savePendingListing(pending);
      retainedPending = pending;
      assertSession(payment.session);
      broadcastStarted = true;
      const returned = await payment.rpc.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
      if (returned !== signature) throw new Error('RPC returned a different signature. Verify the originally signed burn.');
      if (!sessionCurrent(payment.session)) return;
      setPendingStatus('Burn submitted. Waiting for Devnet confirmation.', pending);
      const confirmation = await waitForSignatureConfirmation(payment.rpc, { signature, lastValidBlockHeight: latest.lastValidBlockHeight, commitment:'finalized' });
      if (!sessionCurrent(payment.session)) return;
      if (confirmation?.status?.confirmationStatus !== 'finalized') throw new Error('The original burn has no finalized outcome yet.');
      if (confirmation?.value?.err !== null) {
        if (confirmation?.value?.err !== undefined) {
          confirmedFailure = true;
          try { clearPendingListing(pending); retainedPending = null; pendingNotice = null; }
          catch (error) { setPendingStatus(`The burn failed on-chain. Recovery cleanup is incomplete: ${error.message}`, pending); return; }
          throw new Error('The burn transaction failed on-chain.');
        }
        throw new Error('Finalized confirmation is unavailable.');
      }
      const [sourceAfter, mintAfter] = await Promise.all([
        getAccount(payment.rpc, payment.source.address, 'finalized', payment.tokenProgram),
        getMint(payment.rpc, payment.fundedKey, 'finalized', payment.tokenProgram),
      ]);
      if (payment.source.amount - sourceAfter.amount !== payment.amount || payment.supplyBefore - mintAfter.supply < payment.amount)
        throw new Error('The expected token balance and supply deltas were not observed.');
      if (!sessionCurrent(payment.session)) return;
      busy = false;
      await claimPending(pending);
    } catch (error) {
      if (!sessionCurrent(payment.session)) return;
      if (confirmedFailure) setStatus('The burn transaction failed on Devnet; no listing fee was paid.', signature);
      else if (broadcastStarted) setPendingStatus(`Burn outcome is uncertain: ${error.message} Verify the original receipt; do not submit another burn.`, pending);
      else if (pending && readPending()?.signature === signature) setPendingStatus(`No broadcast was started. The signed burn remains saved for verification: ${error.message}`, pending);
      else setStatus(`No burn submitted: ${error.message}`);
    } finally { busy = false; draw(); }
  }

  mintInput.addEventListener('input', queueLookup);
  payButton.addEventListener('click', preparePayment);
  byId('list-review-cancel').addEventListener('click', () => { prepared = null; review.close(); });
  byId('list-review-confirm').addEventListener('click', submitPayment);
  byId('list-retry').addEventListener('click', () => void claimPending());
  window.addEventListener('funded:reward-identity-change', draw);
  window.addEventListener('funded:route-change', event => { if (event.detail?.route === 'list') void refreshListings(); });
  const pending = readPending();
  if (pending) { mintInput.value = pending.mint; nameInput.value = pending.name; symbolInput.value = pending.symbol; }
  queueLookup(); void refreshConfig(); void refreshListings();
}
