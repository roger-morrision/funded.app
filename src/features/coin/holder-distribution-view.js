import { setCoinField, formatOnChainNumber, shortAddress } from '../shared/display.js';
import { formatTradeAmountInput } from '../../../trade-amount-input.js';
import { formatTokenBaseAmount } from '../../../trade-panel-balance.js';

export function renderCoinAccountDistribution(distribution, decimals = 6, symbol = 'Token', vaultLabel = 'Curve vault'){
  const panel = document.querySelector('#coin-account-distribution');
  if (!panel) return;
  panel.hidden = !distribution;
  const status = document.querySelector('#coin-holder-distribution-status');
  if (status) {
    status.hidden = Boolean(distribution);
    if (!distribution) status.textContent = 'Full holder distribution unavailable: token-account owners and balances could not be reconciled to minted supply.';
  }
  if (!distribution) return;
  const vaultBar = document.querySelector('#coin-distribution-vault');
  const otherBar = document.querySelector('#coin-distribution-other');
  if (vaultBar) vaultBar.style.width = `${Math.max(0, Math.min(100, distribution.vaultShare))}%`;
  if (otherBar) otherBar.style.width = `${Math.max(0, Math.min(100 - distribution.vaultShare, distribution.holderShare))}%`;
  setCoinField('#coin-distribution-vault-label', `${formatOnChainNumber(distribution.vaultShare, 2)}%`);
  setCoinField('#coin-distribution-other-label', `${formatOnChainNumber(distribution.holderShare, 2)}%`);
  setCoinField('#coin-distribution-vault-name', vaultLabel);
  setCoinField('#coin-vault-fact-label', `${vaultLabel} balance`);
  setCoinField('#coin-distribution-other-name', `${distribution.walletCount} holder wallet${distribution.walletCount === 1 ? '' : 's'}`);
  setCoinField('#coin-distribution-note', `Balances across all ${distribution.accountCount} funded token accounts match the total supply. Accounts owned by the same wallet are grouped together.`);
  const list = document.querySelector('#coin-distribution-wallets');
  if (list) {
    list.replaceChildren();
    for (const holder of distribution.holders.slice(0, 3)) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/wallet/${encodeURIComponent(holder.wallet)}`;
      link.title = holder.wallet;
      link.textContent = shortAddress(holder.wallet);
      const amount = document.createElement('span');
      amount.textContent = `${formatTradeAmountInput(formatTokenBaseAmount(holder.amountRaw, decimals, Math.min(decimals, 6)))} ${symbol}`;
      const share = document.createElement('b');
      share.textContent = `${formatOnChainNumber(holder.share, 2)}%`;
      row.append(link, amount, share);
      list.append(row);
    }
  }
}
