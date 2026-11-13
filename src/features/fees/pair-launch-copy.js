import { currentServiceFees } from '../../../service-fees.js';
import { feeDistributionPresentation } from './distribution-summary.js';

// One source for paired-launch wording in Docs, FAQ and the launch form.
// A paired coin goes through the same two-step launch, V3 fee router and
// creator-fee split as a SOL launch; only the token it trades against differs.
export const PAIR_LAUNCH_TOKENS = 'Stablecoins such as USDC, xStocks, Stocks and Crypto';

export function pairLaunchCopy() {
  const split = feeDistributionPresentation().allocation;
  const trade = `${currentServiceFees().tradeBps / 100}%`;
  return {
    what: `Step 1 of Create a coin has an optional Paired with list (${PAIR_LAUNCH_TOKENS}). Leave it on SOL for a SOL launch, or pick a token so your coin trades against it on pump.fun.`,
    fees: `A paired coin uses the same V3 fee router and the same split of collected creator fees as every richpad.fun launch: ${split}`,
    costs: `The launch service fee, the ${trade} app trading fee, reserve, tiers and developer lock work the same way.`,
    status: 'Not open yet: launching with a token other than SOL stays blocked until the fee router can collect and settle creator fees paid in that token. Set Paired with back to SOL to launch now; no transaction is sent while a pair is selected.',
  };
}

export const pairLaunchPoints = () => Object.values(pairLaunchCopy());
