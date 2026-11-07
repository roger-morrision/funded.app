import { formatTinyDecimal } from '../shared/display.js';

const subscripts = '₀₁₂₃₄₅₆₇₈₉';
const scales = { K:1e3, M:1e6, B:1e9, T:1e12 };

// Parse display values only, never addresses, dates, ratios or prose containing numbers.
export function parseMetric(text) {
  const exact = String(text).trim();
  const match = exact.match(/^([≥≤<>≈~]?\s*)([+−-]?)([$€£]?)([+−-]?)(\d[\d,]*(?:\.\d+)?(?:[₀₁₂₃₄₅₆₇₈₉]+\d+)?)([KMBT]?)(\s*(?:%|[A-Za-z]{2,12})?)$/);
  if (!match || (match[2] && match[4])) return null;
  const [, bound, sign, currency, innerSign, number, compact, unit] = match;
  if (number.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(number)) return null;
  const tiny = number.match(/^0\.0([₀₁₂₃₄₅₆₇₈₉]+)(\d+)$/);
  const zeros = tiny ? Number([...tiny[1]].map(d => subscripts.indexOf(d)).join('')) : 0;
  if (zeros > 300 || (/[₀₁₂₃₄₅₆₇₈₉]/.test(number) && !tiny)) return null;
  const raw = tiny ? Number(`0.${'0'.repeat(zeros)}${tiny[2]}`) : Number(number.replaceAll(',', ''));
  const value = raw * (scales[compact] || 1) * (/[−-]/.test(sign + innerSign) ? -1 : 1);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  return { exact, value, bound, currency, unit, compact, tiny:!!tiny,
    decimals: number.split('.')[1]?.length || 0, grouped:number.includes(','),
    plus:(sign + innerSign) === '+', minus:(sign + innerSign) === '−' ? '−' : '-', innerSign:!!innerSign };
}

export function compatibleMetrics(a, b) {
  return a && b && a.bound === b.bound && a.currency === b.currency && a.unit === b.unit;
}

export function formatMetricFrame(value, target) {
  const scaled = Math.abs(value) / (scales[target.compact] || 1);
  const amount = target.tiny ? formatTinyDecimal(scaled) : scaled.toLocaleString('en-US', {
    useGrouping:target.grouped, minimumFractionDigits:Math.min(15, target.decimals),
    maximumFractionDigits:Math.min(15, target.decimals),
  });
  const sign = value < 0 ? target.minus : target.plus ? '+' : '';
  return `${target.bound}${target.innerSign ? target.currency + sign : sign + target.currency}${amount}${target.compact}${target.unit}`;
}

export function metricValueAt(from, to, elapsed, duration = 650) {
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  if (progress === 1) return to;
  return from + (to - from) * (1 - (1 - progress) ** 3);
}
