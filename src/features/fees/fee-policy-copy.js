import { FEE_DISTRIBUTION, APP_REFERRAL_LEVELS } from '../../../distribution-policy.js';
import { DAILY_BONUS_POLICY } from '../../../config/daily-bonus.js';

// Read live bindings when rendering so saved admin policy overrides the build default.
export function currentFeePolicyCopy() {
  const fee = FEE_DISTRIBUTION;
  const rates = [fee.operationsEffectivePercent, fee.appReferralEffectivePercent,
    fee.communityEffectivePercent, fee.buybackEffectivePercent];
  const names = ['Operations & marketing', 'Referral network', 'Daily bonus', '$FUNDED buyback'];
  return {
    allocation: `${fee.creatorPercent}% creator-directed · ${rates.map((rate, i) => `${rate}% ${names[i]}`).join(' · ')}.`,
    scope: 'Current policy for new launches. Existing coins and historical settlements keep their recorded rates. Allocated SOL is not a wallet balance or a completed payment.',
    collection: 'Trades accrue creator fees on Pump. The keeper collects verified fees into the coin’s V3 router when its collection conditions are met. The launch creator reviews and signs settlement; funding and recipient payments are verified separately.',
    creator: 'The creator-directed 80% follows the launch-time split between the creator wallet, coin holders, and an eligible X account. The creator wallet share is paid after its signed payout transaction finalizes.',
    holders: 'Holder SOL payouts are automatic after a funded reward pool and complete finalized eligibility snapshot are verified; recipients do not claim or sign. Standard payouts are hourly; selected Devnet QA coins use five-minute cycles and reduced minimums. Check the coin’s current conditions and receipt.',
    x: 'X rewards require the allocated X account to sign in, link the recipient wallet, and claim. A completed sign-in or signature prompt is not a finalized payment.',
    referrals: `Referral levels 1–3 allocate ${APP_REFERRAL_LEVELS.map(level => `${level.effectivePercentOfCreatorFees}%`).join(' / ')} of gross collected fees when those levels qualify. Recipients do not submit a separate claim. Payouts require creator-approved transfers and finalized receipts.`,
    reserve: 'Missing referral levels stay in the community reserve. They are not reassigned to another inviter or added to the Daily bonus pool.',
    bonus: `The ${fee.communityEffectivePercent}% Daily bonus pool is split equally across creators, direct referrers, and traders. Each completed UTC day closes at 00:00 UTC. Each group awards ${DAILY_BONUS_POLICY.rankPercents[0]}% to 1st, ${DAILY_BONUS_POLICY.rankPercents[1]}% to 2nd, and ${DAILY_BONUS_POLICY.rankPercents[2]}% to 3rd. Creators rank by finalized settled fees, referrers by direct referred creators’ settled fees, and traders by finalized buy and sell SOL volume. Fees qualify in the window when settlement finalizes; later settlements enter a later window. Paid rankings stay frozen.`,
    bonusFunding: 'Daily bonuses are paid automatically to winning wallets after the snapshot and source funding are verified. No manual claim or recipient signature is required. Standard snapshots close daily; an explicitly labeled Devnet QA mode uses five-minute windows for selected test coins, with checks every 30 seconds. The cutoff is not an immediate payment guarantee. Ties use wallet address order; unfilled ranks retain their share in the reserve. The separate community airdrop uses launched coin tokens, not this SOL pool.',
    buyback: 'The buyback allocation stays in dedicated program vaults until the configured aggregate trigger is met. The worker then attempts a protected $FUNDED purchase and burn. Market checks and finalized purchase/burn receipts are required; the allocation itself is not a burn.',
    steps: rates.map((rate, i) => `${rate}% ${names[i]}`),
  };
}
