// Disconnected Portfolio: open any wallet's public activity page by address,
// so visitors can look around before connecting a wallet.
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function walletLookupPath(value) {
  const address = String(value || '').trim();
  return ADDRESS.test(address) ? `/wallet/${encodeURIComponent(address)}` : null;
}

export function mountWalletLookup(document = globalThis.document) {
  const host = document.querySelector('#portfolio-holdings-disconnected');
  if (!host || host.querySelector('[data-wallet-lookup]')) return;
  const form = document.createElement('form');
  form.className = 'portfolio-wallet-lookup';
  form.dataset.walletLookup = '';
  form.noValidate = true;
  form.innerHTML = `<label for="portfolio-wallet-lookup">Or view any wallet</label>
    <span class="portfolio-wallet-lookup-row"><input id="portfolio-wallet-lookup" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="Paste a Solana wallet address" aria-describedby="portfolio-wallet-lookup-status" />
    <button type="submit" class="secondary-button">View</button></span>
    <small id="portfolio-wallet-lookup-status" role="status"></small>`;
  const input = form.querySelector('input'), status = form.querySelector('small');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const path = walletLookupPath(input.value);
    if (!path) { status.textContent = 'Enter a valid Solana wallet address.'; input.focus(); return; }
    status.textContent = '';
    globalThis.location.assign(path);
  });
  input.addEventListener('input', () => { status.textContent = ''; });
  host.append(form);
}
