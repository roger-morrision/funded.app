// Defaults for future launches. Authority-signed on-chain settings override
// these defaults; existing launches and open drops retain their saved terms.
export const DEFAULT_AGENCY_RULES = Object.freeze({
  marketCapUsd: Object.freeze([100_000, 300_000]),
  communityWindowSeconds: 90 * 86400,
  promotionIntervalSeconds: 86400,
});
export function validateAgencyRules(input) {
  const fields = ['marketCapUsd','communityWindowSeconds','promotionIntervalSeconds','source'];
  if (!input || Object.keys(input).some(key=>!fields.includes(key))
    || !Array.isArray(input.marketCapUsd) || input.marketCapUsd.length!==2
    || input.marketCapUsd.some(value=>!Number.isSafeInteger(value)||value<1||value>1_000_000_000)
    || input.marketCapUsd[1]<=input.marketCapUsd[0]
    || !Number.isSafeInteger(input.communityWindowSeconds) || input.communityWindowSeconds<300 || input.communityWindowSeconds>31536000
    || !Number.isSafeInteger(input.promotionIntervalSeconds) || input.promotionIntervalSeconds<300 || input.promotionIntervalSeconds>2592000)
    throw new Error('Use increasing market caps of $1–$1bn, a 5-minute–365-day claim window, and a promotion billing interval of 1–30 days (5 minutes allowed on Devnet test builds).');
  return {marketCapUsd:[...input.marketCapUsd],communityWindowSeconds:input.communityWindowSeconds,
    promotionIntervalSeconds:input.promotionIntervalSeconds};
}
