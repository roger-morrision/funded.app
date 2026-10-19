export const DEFAULT_SERVICE_FEES = Object.freeze({
  tradeBps:75, launchLamports:'20000000', proUsd:150, premierUsd:300, listingUsd:300,
});
let current = DEFAULT_SERVICE_FEES;
export const currentServiceFees = () => current;
export function validateServiceFees(input) {
  const keys = Object.keys(DEFAULT_SERVICE_FEES);
  if (!input || Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unknown service fee field.');
  const { tradeBps, launchLamports, proUsd, premierUsd, listingUsd } = input;
  if (!Number.isInteger(tradeBps) || tradeBps < 0 || tradeBps > 500
    || typeof launchLamports !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(launchLamports)
    || BigInt(launchLamports) > 5_000_000_000n
    || [proUsd,premierUsd,listingUsd].some(value => !Number.isInteger(value) || value < 1 || value > 100_000)
    || premierUsd <= proUsd) throw new Error('Use trading 0–500 bps, launch 0–5 SOL in exact lamports, positive whole USD prices, and Premier above Pro.');
  return Object.freeze({ tradeBps, launchLamports, proUsd, premierUsd, listingUsd });
}
export function setCurrentServiceFees(input) { return current = validateServiceFees(input); }
export const serviceFeeSol = input => Number(input ?? current.launchLamports) / 1_000_000_000;
