import {AUTOMATIC_REWARDS} from '../../../automatic-rewards.js';
import {DAILY_BONUS_POLICY} from '../../../config/daily-bonus.js';
import {DEFAULT_AGENCY_RULES} from '../../../config/agency-rules.js';
import {escapeHtml} from '../shared/display.js';

// Explain eligibility and delivery without asserting that a live executor is on.
export function feeBenefitExplanation(key){
  const ranks=DAILY_BONUS_POLICY.rankPercents;
  const milestones=DEFAULT_AGENCY_RULES.marketCapUsd.map(n=>`$${n.toLocaleString('en-US')}`).join(' and ');
  const explanations={
    creator:{
      who:'The creator wallet, eligible holders of this coin and the named X account, only where the coin’s saved launch split gives them a share.',
      when:'Creator-wallet SOL is received after the creator approves a payout and it finalizes. Holder SOL uses standard hourly cutoffs after the reward program is active and funded. X rewards become receivable when the named account has an eligible funded claim.',
      receive:'The creator approves their payout. Eligible coin holders receive SOL automatically without claiming or signing. The named X recipient must sign in with the matching X account, link a wallet and claim.',
      conditions:`For current standard holder programs, the closing balance must meet a $${AUTOMATIC_REWARDS.minimumHolderUsd}-equivalent minimum in this coin. Rewards are weighted by balance and holding time. The pool must meet its $${AUTOMATIC_REWARDS.minimumPoolUsd}-equivalent minimum plus distribution costs. Selected, labeled Devnet QA coins use five-minute periods and reduced minimums. Each coin’s saved rules and verified price apply.`,
      links:[['Holder eligibility & schedule','#payments/holders'],['X claims','#payments/x']],
    },
    operations:{
      who:'Platform operations and marketing budgets. This is the app’s allocation, rather than an additional wallet reward for creators, traders or holders.',
      when:'The saved allocation is accounted for when collected creator fees are settled. Operational spending depends on available funds and approved execution; it has no holder-bonus payout schedule.',
      receive:'There is no user claim for this category. It funds the platform services and marketing described by the published policy.',
      links:[['Review the fee route','#capital-flow']],
    },
    referrals:{
      who:'Qualified inviter wallets in the creator’s saved first-, second- and third-level referral network. Attribution must exist before the first qualifying settlement; the upline then stays frozen. Self-referrals and referral cycles are rejected.',
      when:'Rewards accrue from eligible collected and settled creator fees, not from a signup, a link click or trading volume alone. A recipient receives SOL after the creator approves the allocated referral transfer and its transaction finalizes; there is no fixed daily payment time.',
      receive:'Share your invite link before the creator qualifies. Referral recipients do not submit a separate claim. Connect the receiving wallet in Referrals to inspect its recorded entitlement and finalized payouts.',
      conditions:'Missing referral levels remain in the community reserve. Their shares are not reassigned to another inviter or added to the Daily bonus pool.',
      links:[['Invite link & referral payouts','#referrals']],
    },
    community:{
      who:'The top 3 wallets in each of three categories: creators by finalized settled creator fees, direct referrers by their referred creators’ settled fees, and traders by finalized buy and sell SOL volume. Participation alone does not earn a ranked award.',
      when:'Each standard UTC day closes at 00:00 UTC. Rankings are fixed after that completed window is verified. Fees enter the window in which settlement finalizes. Payment follows verified funding and snapshot checks, only when automatic bonus payouts are enabled; the cutoff is not an immediate payment promise.',
      receive:'Winning wallets receive SOL automatically when payouts are enabled and ready. No manual claim or recipient signature is required. Each trade may wake ready processing, but cannot pay an unfinished ranking window. Check Daily bonuses for current availability and receipts.',
      conditions:`Each category receives one third of the bonus pool. Within that category, 1st receives ${ranks[0]}%, 2nd ${ranks[1]}% and 3rd ${ranks[2]}%. Unfilled ranks retain their share in the reserve. Only explicitly labeled Devnet QA programs use five-minute ranking windows.`,
      links:[['Bonus rankings, availability & payouts','#bonuses']],
    },
    buyback:{
      who:'The $FUNDED ecosystem through confirmed supply reduction. This allocation does not distribute SOL or purchased tokens to holder wallets.',
      when:'Funds accumulate until the live aggregate buyback trigger and applicable source-order minimums are met. An enabled executor must also pass market, quote and execution checks. This is condition-based, not a guaranteed hourly, daily or every-trade burn.',
      receive:'There is no claim. The funded process purchases $FUNDED and burns it. A completed benefit is evidenced by finalized purchase and burn receipts, rather than an allocation or a full progress bar.',
      links:[['Current trigger & burn receipts','#buybacks']],
    },
    agency:{
      who:'Every new coin includes all three agents: X promotion and two buyback-and-burn agents for the launched coin. Coin holders do not claim this allocation as a cash reward.',
      when:`Each buyback agent can execute once at its saved, verified market-cap milestone, after funding and execution checks pass. Default milestones are ${milestones}; the coin’s saved values apply. X promotion follows its saved interval, normally at least ${DEFAULT_AGENCY_RULES.promotionIntervalSeconds/3600} hours between billed posts, and is billed only after the post is verified.`,
      receive:'For new launches the budget is divided equally across all three included agents. Existing coins retain their saved selections. Execution also requires an enabled, ready executor; crossing a market-cap milestone alone is not proof of a purchase or burn. Unused budgets stay reserved.',
      links:[['Included agents, rules & receipts','#marketing-agency']],
    },
  };
  return explanations[key]||null;
}

export function feeBenefitDetailsMarkup(rows){
  return `<dl>${rows.map(row=>{
    const detail=feeBenefitExplanation(row.key);if(!detail)return '';
    const fields=[['Who receives it',detail.who],['When it is received',detail.when],['How to receive it',detail.receive],...(detail.conditions?[['Eligibility & amounts',detail.conditions]]:[])];
    return `<div class="fee-benefit-detail" data-fee-benefit="${escapeHtml(row.key)}"><dt>${row.percent}% · ${escapeHtml(row.label)}</dt><dd><p class="fee-benefit-purpose">${escapeHtml(row.benefit)}</p><ul class="fee-benefit-facts">${fields.map(([label,value])=>`<li><strong>${label}</strong><span>${escapeHtml(value)}</span></li>`).join('')}</ul><nav class="fee-benefit-links" aria-label="${escapeHtml(row.label)} details">${detail.links.map(([label,href])=>`<a href="${href}">${escapeHtml(label)} →</a>`).join('')}</nav></dd></div>`;
  }).join('')}</dl><p class="fee-benefit-separate"><strong>Separate community token airdrops:</strong> These use the launched coin’s reserved tokens, rather than this SOL fee split. Eligible $FUNDED-holder wallets need a verified eligibility snapshot and a funded, active drop, then claim within its saved window (normally ${DEFAULT_AGENCY_RULES.communityWindowSeconds/86400} days). Standard snapshots are tied to migration; explicitly labeled Devnet QA drops may use a separate QA cutoff. Holding $FUNDED is different from holding this coin for its holder SOL rewards.</p><p>Schedules describe eligibility windows. Actual payment still requires the applicable program to be enabled, eligible funds, required approvals or claims, and a finalized payment receipt.</p>`;
}
