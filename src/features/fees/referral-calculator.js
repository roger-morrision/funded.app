// Referral earnings calculator for the Referrals page: type the creator fees an
// invited creator collects and see what each referral level receives, using
// the same rate table as the published copy.

const LEVEL_NAMES = ['Direct (L1)', 'Second level (L2)', 'Third level (L3)'];

export function referralEarnings(feesSol, levels) {
  const fees = Number(feesSol);
  if (!Number.isFinite(fees) || fees < 0 || !Array.isArray(levels)) return null;
  return levels.map(({ level, rate }) => ({
    level,
    label: LEVEL_NAMES[level - 1] || `Level ${level}`,
    rate,
    sol: Number((fees * rate / 100).toFixed(9)),
  }));
}

const formatSol = value => `${value.toLocaleString('en-US', { maximumFractionDigits: value > 0 && value < 0.001 ? 9 : 6 })} SOL`;

export function mountReferralCalculator(host, levels) {
  if (!host || !Array.isArray(levels) || !levels.length) return null;
  const document = host.ownerDocument;
  let root = host.querySelector('[data-referral-calculator]');
  if (!root) {
    root = document.createElement('div');
    root.className = 'referral-calculator';
    root.dataset.referralCalculator = '';
    root.innerHTML = '<label>Creator fees collected by someone you invited<span><input type="number" min="0" step="0.1" inputmode="decimal" value="10" aria-describedby="referral-calculator-note" /><b>SOL</b></span></label>'
      + '<ul aria-live="polite"></ul><small id="referral-calculator-note">Example only. Each payout follows its coin’s saved on-chain policy and needs collected, funded fees.</small>';
    host.append(root);
    root.querySelector('input').addEventListener('input', () => render());
  }
  const input = root.querySelector('input'), list = root.querySelector('ul');
  function render() {
    const rows = referralEarnings(input.value === '' ? 0 : input.value, levels);
    list.replaceChildren(...(rows || []).map(row => {
      const item = document.createElement('li');
      const name = document.createElement('span'); name.textContent = `${row.label} · ${row.rate}%`;
      const value = document.createElement('strong'); value.textContent = formatSol(row.sol);
      item.append(name, value); return item;
    }));
    if (!rows) {
      const item = document.createElement('li'); item.textContent = 'Enter a positive SOL amount.'; list.append(item);
    }
  }
  render();
  return root;
}
