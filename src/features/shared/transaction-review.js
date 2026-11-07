export function reviewRows({ network, amount, recipient, fees, result }) {
  return [['Network', network === 'devnet' ? 'Solana Devnet · test assets' : network === 'mainnet-beta' ? 'Solana Mainnet' : 'Network unavailable'],
    ['Amount', amount || 'Unavailable'], ['Recipient', recipient || 'Connect a receiving wallet'],
    ['Fees', fees || 'Unavailable · check the wallet review'], ['Expected result', result || 'Pending verification']];
}

// Text nodes preserve full addresses and keep untrusted token names out of HTML.
export function renderTransactionReview(parent, values) {
  if (!parent) return;
  const document = parent.ownerDocument;
  let root = parent.querySelector(':scope > [data-transaction-review]');
  if (!root) { root = document.createElement('dl'); root.dataset.transactionReview = ''; root.className = 'transaction-review-summary'; root.setAttribute('aria-label', 'Transaction summary'); parent.prepend(root); }
  root.replaceChildren(...reviewRows(values).map(([label, value]) => {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value; row.append(dt, dd); return row;
  }));
}
