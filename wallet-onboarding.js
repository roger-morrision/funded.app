const labels = { phantom:'Phantom', backpack:'Backpack', solflare:'Solflare', legacy:'Browser wallet' };
export function availableWalletChoices(entries) {
  const seen = new Set();
  return entries.filter(({ provider }) => {
    if (!provider || typeof provider.connect !== 'function' || typeof provider.signTransaction !== 'function' || seen.has(provider)) return false;
    seen.add(provider); return true;
  }).map(entry => ({ ...entry, label:labels[entry.id] || 'Solana wallet' }));
}

let pendingChoice;
export function chooseWallet(entries, { devnet = false, preferred = '' } = {}) {
  if (pendingChoice) return pendingChoice;
  const dialog = document.querySelector('#wallet-onboarding-dialog');
  const options = dialog.querySelector('#wallet-onboarding-options');
  const status = dialog.querySelector('#wallet-onboarding-status');
  options.replaceChildren();
  dialog.querySelector('#wallet-onboarding-network').textContent = devnet
    ? 'Solana Devnet · use test SOL, which has no monetary value.' : 'Solana · transactions require SOL for network fees.';
  const choices = availableWalletChoices(entries);
  status.textContent = choices.length ? 'Choose a wallet, approve the connection, then sign the free sign-in message.'
    : 'No browser wallet detected. Use Phantom on your phone, or open this site in a browser with a Solana wallet installed.';
  for (const entry of choices) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'wallet-onboarding-option'; button.dataset.walletChoice = entry.id;
    const name = document.createElement('strong'); name.textContent = entry.label;
    const hint = document.createElement('small'); hint.textContent = entry.id === preferred ? 'Previously used · detected' : 'Detected in this browser';
    button.append(name, hint); options.append(button);
  }
  pendingChoice = new Promise(resolve => {
    let result = null;
    const click = event => {
      const selected = event.target.closest('[data-wallet-choice]');
      if (!selected) return;
      result = selected.dataset.walletChoice === 'mobile' ? { mobile:true }
        : choices.find(entry => entry.id === selected.dataset.walletChoice) || null;
      dialog.close();
    };
    dialog.addEventListener('click', click);
    dialog.addEventListener('close', () => {
      dialog.removeEventListener('click', click); pendingChoice = null; resolve(result);
    }, { once:true });
    dialog.showModal();
  });
  return pendingChoice;
}
