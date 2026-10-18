// Edit the percentages of funded.vip's fixed 20% share of collected Pump
// creator fees. The values below must total 100% of that protocol share;
// the creator-directed 80% is intentionally fixed by the current router.
// Rebuild the app and restart the API together after an edit. New launches
// snapshot the rates; existing launches and settlements keep their old rates.
// V3 snapshots these category units on-chain when a new mint is initialized.
export const PROTOCOL_FEE_SPLIT = Object.freeze({
  operationsPercent: 40,
  referralLevelPercents: Object.freeze([10, 3, 2]),
  communityPercent: 20,
  buybackPercent: 25,
});
