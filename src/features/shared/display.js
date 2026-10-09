export function escapeHtml(value){ return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }

export function shortAddress(address){ return address ? `${address.slice(0, 6)}…${address.slice(-6)}` : '—'; }

export function formatOnChainNumber(value, digits = 4){
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatCoinSpot(value){
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value !== 0 && Math.abs(value) < 0.000001) {
    const fixed = value.toFixed(15).replace(/0+$/, '').replace(/\.$/, '');
    return `${fixed} SOL`;
  }
  return `${formatOnChainNumber(value, 9)} SOL`;
}

export function formatUsd(value){
  const amount = Number(value);
  if (value == null || value === '' || !Number.isFinite(amount)) return '—';
  if (amount === 0) return '$0.00';
  if (amount > 0 && amount < 0.01) return '< $0.01';
  if (amount >= 1) return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (amount >= 0.01) return `$${amount.toFixed(4)}`;
  const digits = Math.min(12, Math.max(4, Math.ceil(-Math.log10(amount)) + 4));
  return `$${amount.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function formatCompactUsd(value){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';
  return `$${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)}`;
}

export function formatDashboardUsd(value, { partial = false } = {}){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '$—';
  if (amount > 0 && amount < 0.01) return `${partial ? '≥' : ''}<$0.01`;
  const formatted = amount >= 1_000_000
    ? Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)
    : amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${partial ? '≥' : ''}$${formatted}`;
}

export function formatSmallDashboardUsd(value, { partial = false } = {}){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '$—';
  if (amount === 0) return `${partial ? '≥' : ''}$0.00`;
  return `${partial ? '≥' : ''}${amount > 0 && amount < 0.01 ? formatUsd(amount) : formatDashboardUsd(amount)}`;
}

export function formatDashboardQuantity(value){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '—';
  return amount >= 1_000_000
    ? Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)
    : amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function setCoinField(selector, value, root = globalThis.document){ const node = root.querySelector(selector); if (node) node.textContent = value; }

export function setCoinFact(selector, value, state = 'unknown', root = globalThis.document){
  const node = root.querySelector(selector);
  if (node) { node.textContent = value; node.dataset.state = state; }
}
