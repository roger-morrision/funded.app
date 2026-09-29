export function formatTradeAmountInput(value) {
  const raw = String(value ?? '').replaceAll(',', '').trim();
  if (!raw || !/^\d*(?:\.\d*)?$/.test(raw)) return raw;
  const dot = raw.indexOf('.');
  const integer = dot < 0 ? raw : raw.slice(0, dot);
  const fraction = dot < 0 ? '' : raw.slice(dot);
  const normalized = integer.replace(/^0+(?=\d)/, '') || '0';
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fraction;
}

export function parseTradeAmountInput(value) {
  const raw = String(value ?? '').replaceAll(',', '').trim();
  if (!/^\d+(?:\.\d*)?$/.test(raw)) return Number.NaN;
  return Number(raw);
}
