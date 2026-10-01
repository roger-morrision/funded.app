// Percentages of funded.vip's 20% share of collected Pump creator fees.
// Edit these values together; they must total 100. Changes apply only to new
// launches after the app and API are rebuilt/restarted. Existing launch policy
// snapshots and settlements retain their original percentages.
export const PROTOCOL_FEE_SPLIT = Object.freeze({
  operationsPercent: 70,
  referralLevelPercents: Object.freeze([10, 3, 2]),
  communityPercent: 10,
  buybackPercent: 5,
});
