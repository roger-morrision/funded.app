export const BOOST_PACKAGES = Object.freeze([
  { id: '10x', multiplier: 10, hours: 12, usd: 49.50 },
  { id: '30x', multiplier: 30, hours: 12, usd: 124.50 },
  { id: '50x', multiplier: 50, hours: 12, usd: 199.50 },
  { id: '100x', multiplier: 100, hours: 24, usd: 449.50 },
  { id: '500x', multiplier: 500, hours: 24, usd: 1999.50 },
]);

export function boostPackage(id) {
  return BOOST_PACKAGES.find(item => item.id === id) || null;
}
