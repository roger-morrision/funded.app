import { Buffer } from 'buffer';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAccount, getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import { apiRequest } from './client.js';
import { waitForSignatureConfirmation } from './funded-burn.js';
import { LISTING_BURN_TOKENS, LISTING_DEVNET_GENESIS_HASH, listingBurnBaseUnits, listingMemo } from './listing-policy.js';
import { canSignTransactions } from './wallet-core.js';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const PENDING_KEY = 'funded.vip.pending-listing-burn.v1';
const byId = id => document.getElementById(id);

function readPending() {
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
}
function savePending(value) {
  try { if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value)); else sessionStorage.removeItem(PENDING_KEY); } catch {}
}

export function initPaidListing({ getSolana, getConnection, getSession, assertSession, connectWallet, cluster, fundedMint, mainnetReadOnly }) {
  const mintInput = byId('list-mint');
  if (!mintInput) return;
  const nameInput = byId('list-name');
  const symbolInput = byId('list-symbol');
  const detailFields = document.querySelector('.list-token-fields');
  const detailNote = document.querySelector('.list-field-note');
  const help = byId('list-mint-help');
  const availability = byId('list-availability');
  const status = byId('list-payment-status');
  const payButton = byId('list-pay');
  const review = byId('list-review');
  const recovery = byId('list-recovery');
  const live = byId('list-live-items');
  const exploreLive = byId('explore-paid-listing-items');
  let config = null;
  let listings = [];
  let listingsAvailable = false;
  let busy = false;
  let prepared = null;

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
    for (const element of [detailFields, detailNote, payButton, status]) if (element) element.hidden = !mint;
    mintInput.removeAttribute('aria-invalid');
    help.classList.remove('is-valid', 'is-invalid');
    if (!value) help.textContent = 'Enter a Solana Devnet mint to check its address format.';
    else if (!mint) { help.textContent = 'Enter a valid Solana mint address.'; help.classList.add('is-invalid'); mintInput.setAttribute('aria-invalid', 'true'); }
    else { help.textContent = 'Valid address format. The token mint will be checked on Devnet before payment.'; help.classList.add('is-valid'); }
    const existing = mint && listings.find(item => item.mint === mint);
    const pending = readPending();
    recovery.hidden = !pending;
    const ready = listingsAvailable && config?.enabled === true && config.cluster === 'devnet' && config.fundedMint === fundedMint
      && Number(config.burnTokens) === Number(LISTING_BURN_TOKENS) && cluster === 'devnet' && !mainnetReadOnly;
    availability.textContent = ready ? '25,000 $FUNDED · Devnet' : 'Payment unavailable';
    payButton.disabled = !ready || !mint || !nameInput.value.trim() || !symbolInput.value.trim() || busy || Boolean(existing) || Boolean(pending);
    payButton.textContent = busy ? 'Processing…' : pending ? 'Resolve pending burn first' : existing ? 'Already listed' : ready ? 'Review 25,000 $FUNDED burn' : 'Listing unavailable';
    if (existing) setStatus('This mint is already listed.', existing.signature);
  }
  function renderListings() {
    for (const container of [live, exploreLive].filter(Boolean)) {
      container.replaceChildren();
      if (!listings.length) { const empty = document.createElement('p'); empty.textContent = 'No paid listings have been verified on Devnet yet.'; container.append(empty); continue; }
      for (const item of listings) {
      const row = document.createElement('a'); row.href = `/token/${encodeURIComponent(item.mint)}`; row.setAttribute('role', 'listitem');
      const title = document.createElement('strong'); title.textContent = `${item.name} · ${item.symbol}`;
      const mint = document.createElement('code'); mint.textContent = item.mint;
      const note = document.createElement('small'); note.textContent = '25,000 $FUNDED burn finalized · token name and ticker verified';
      row.append(title, mint, note); container.append(row);
      }
    }
  }
  async function refreshListings() {
    try {
      const result = await apiRequest('/api/listings', { signal: AbortSignal.timeout(8000) });
      if (!result.available || result.data?.cluster !== 'devnet' || !Array.isArray(result.data.listings)) throw new Error('Listing index unavailable.');
      listings = result.data.listings;
      listingsAvailable = true;
      const pending = readPending();
      if (pending && listings.some(item => item.mint === pending.mint && item.signature === pending.signature)) savePending(null);
      renderListings(); draw();
      return true;
    } catch { listingsAvailable = false; live.textContent = 'The verified listing index is unavailable.'; if (exploreLive) exploreLive.textContent = 'The verified listing index is unavailable.'; setStatus('The public listing index is unavailable. Payment is paused.'); draw(); return false; }
  }
  async function refreshConfig() {
    try {
      const result = await apiRequest('/api/listings/config', { signal: AbortSignal.timeout(8000) });
      config = result.available ? result.data : null;
      const pending = readPending();
      setStatus(pending ? 'A prior burn is awaiting receipt verification. Retry the receipt before another payment.'
        : config?.enabled ? 'Enter a mint, name, and ticker to review the burn.' : 'Listing payments are unavailable until the Devnet API and $FUNDED mint are configured.', pending?.signature);
    } catch { config = null; setStatus('Listing payment service unavailable. No burn can be submitted.'); }
    draw();
  }
  async function preparePayment() {
    if (payButton.disabled) return;
    busy = true; draw();
    try {
      if (!await refreshListings()) throw new Error('The public listing index is unavailable. Payment is paused.');
      if (listings.some(item => item.mint === mintValue())) throw new Error('This mint is already listed. No new payment is needed.');
      let session = getSession();
      if (!session) { await connectWallet(); session = getSession(); }
      if (!session || !canSignTransactions(session.provider)) throw new Error('Connect a signing Devnet wallet to continue.');
      await getSolana();
      const rpc = getConnection();
      if (await rpc.getGenesisHash() !== LISTING_DEVNET_GENESIS_HASH) throw new Error('Wallet RPC is not connected to Solana Devnet. No burn was submitted.');
      const mint = new PublicKey(mintInput.value.trim()).toBase58();
      const mintAccount = await rpc.getAccountInfo(new PublicKey(mint), 'finalized');
      if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)))
        throw new Error('This mint is not a supported SPL token on Devnet.');
      const listingMetadata = await apiRequest(`/api/listings/mint/${encodeURIComponent(mint)}`, { signal:AbortSignal.timeout(12000) });
      if (!listingMetadata.available || listingMetadata.data?.mint !== mint || listingMetadata.data?.cluster !== 'devnet'
        || !listingMetadata.data?.name || !listingMetadata.data?.symbol)
        throw new Error('Verified token metadata is unavailable. No burn was submitted.');
      if (nameInput.value.trim() !== listingMetadata.data.name || symbolInput.value.trim() !== listingMetadata.data.symbol)
        throw new Error(`Use the verified token name and ticker: ${listingMetadata.data.name} (${listingMetadata.data.symbol}). No burn was submitted.`);
      const fundedKey = new PublicKey(fundedMint);
      const fundedAccount = await rpc.getAccountInfo(fundedKey, 'confirmed');
      if (!fundedAccount || (!fundedAccount.owner.equals(TOKEN_PROGRAM_ID) && !fundedAccount.owner.equals(TOKEN_2022_PROGRAM_ID)))
        throw new Error('The configured $FUNDED mint is unavailable on Devnet.');
      const tokenProgram = fundedAccount.owner;
      const funded = await getMint(rpc, fundedKey, 'confirmed', tokenProgram);
      const amount = listingBurnBaseUnits(funded.decimals);
      const accounts = await rpc.getTokenAccountsByOwner(new PublicKey(session.address), { mint: fundedKey }, 'confirmed');
      const source = accounts.value.map(row => ({ address: row.pubkey, amount: unpackAccount(row.pubkey, row.account, tokenProgram).amount }))
        .find(row => row.amount >= amount);
      if (!source) throw new Error('This wallet needs 25,000 $FUNDED in one token account to list this mint.');
      assertSession(session);
      prepared = { session, rpc, mint, name: nameInput.value.trim(), symbol: symbolInput.value.trim(),
        fundedKey, tokenProgram, decimals: funded.decimals, amount, source, supplyBefore: funded.supply };
      byId('list-review-mint').textContent = mint;
      byId('list-review-wallet').textContent = session.address;
      review.showModal();
      setStatus('Review the exact Devnet burn before asking your wallet to sign.');
    } catch (error) { setStatus(error.message || 'Listing review is unavailable.'); }
    finally { busy = false; draw(); }
  }
  async function claimPending(pending = readPending()) {
    if (!pending) return;
    busy = true; draw();
    try {
      const result = await apiRequest('/api/listings', { method: 'POST', body: pending, signal: AbortSignal.timeout(20000) });
      if (!result.available || result.data?.mint !== pending.mint || result.data?.signature !== pending.signature || result.data?.onchainVerified !== true)
        throw new Error('The receipt was not confirmed by the listing index.');
      savePending(null);
      setStatus('Listing verified and live in the index.', pending.signature);
      await refreshListings();
      window.dispatchEvent(new Event('funded:listing-verified'));
    } catch (error) { setStatus(`Burn submitted; listing verification is pending: ${error.message}`, pending.signature); }
    finally { busy = false; draw(); }
  }
  async function submitPayment() {
    const payment = prepared; prepared = null; review.close();
    if (!payment) return;
    busy = true; draw();
    let signature = '';
    let confirmedFailure = false;
    try {
      assertSession(payment.session);
      if (mintInput.value.trim() !== payment.mint || nameInput.value.trim() !== payment.name || symbolInput.value.trim() !== payment.symbol)
        throw new Error('Listing details changed. Review the payment again.');
      const latest = await payment.rpc.getLatestBlockhash('confirmed');
      const transaction = new Transaction({ feePayer: payment.session.provider.publicKey, recentBlockhash: latest.blockhash }).add(
        createBurnCheckedInstruction(payment.source.address, payment.fundedKey, payment.session.provider.publicKey,
          payment.amount, payment.decimals, [], payment.tokenProgram),
        new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(listingMemo(payment.mint), 'utf8') }),
      );
      setStatus('Review the irreversible 25,000 $FUNDED burn in your wallet.');
      const signed = await payment.session.provider.signTransaction(transaction);
      assertSession(payment.session);
      signature = await payment.rpc.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      const pending = { mint: payment.mint, name: payment.name, symbol: payment.symbol, wallet: payment.session.address, signature };
      savePending(pending);
      setStatus('Burn submitted. Waiting for Devnet confirmation.', signature);
      const confirmation = await waitForSignatureConfirmation(payment.rpc, { signature, lastValidBlockHeight: latest.lastValidBlockHeight, commitment:'finalized' });
      if (confirmation.value.err) { savePending(null); confirmedFailure = true; throw new Error('The burn transaction failed on-chain.'); }
      const [sourceAfter, mintAfter] = await Promise.all([
        getAccount(payment.rpc, payment.source.address, 'finalized', payment.tokenProgram),
        getMint(payment.rpc, payment.fundedKey, 'finalized', payment.tokenProgram),
      ]);
      if (payment.source.amount - sourceAfter.amount !== payment.amount || payment.supplyBefore - mintAfter.supply < payment.amount)
        throw new Error('The expected token balance and supply deltas were not observed.');
      await claimPending(pending);
    } catch (error) {
      setStatus(confirmedFailure ? 'The burn transaction failed on Devnet; no listing fee was paid.'
        : signature ? `Burn submitted; listing verification is pending: ${error.message}` : `No burn submitted: ${error.message}`, signature);
    } finally { busy = false; draw(); }
  }

  for (const input of [mintInput, nameInput, symbolInput]) input.addEventListener('input', () => {
    draw();
    if (!payButton.disabled) setStatus('Ready to check the mint and wallet balance before the burn.');
  });
  payButton.addEventListener('click', preparePayment);
  byId('list-review-cancel').addEventListener('click', () => { prepared = null; review.close(); });
  byId('list-review-confirm').addEventListener('click', submitPayment);
  byId('list-retry').addEventListener('click', () => void claimPending());
  window.addEventListener('funded:reward-identity-change', draw);
  window.addEventListener('funded:route-change', event => { if (event.detail?.route === 'list') void refreshListings(); });
  const pending = readPending();
  if (pending) { mintInput.value = pending.mint; nameInput.value = pending.name; symbolInput.value = pending.symbol; }
  draw(); void refreshConfig(); void refreshListings();
}
