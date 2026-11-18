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
      when:'Creator-wallet SOL is available to claim manually after collection and settlement. Holder SOL uses standard hourly cutoffs after the reward program is active and funded. X rewards become receivable when the named account has an eligible funded claim.',
      receive:'Creators open Rewards → Coin creator, select their coin and choose Claim creator fees, then sign with the launch creator wallet. Eligible coin holders receive SOL automatically without claiming or signing. The named X recipient must sign in with the matching X account, link a wallet and claim.',
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
      when:'Rewards accrue from eligible collected and settled creator fees, not from a signup, a link click or trading volume alone. A recipient claims available three-level referral SOL manually after settlement; there is no fixed daily payment time.',
      receive:'Share your invite link before the creator qualifies. Open Referrals with the earning wallet, choose Claim reward and sign its claim message. Daily referrer bonuses remain automatic.',
      conditions:'Missing referral levels remain in the community reserve. Their shares are not reassigned to another inviter or added to the Daily bonus pool.',
      links:[['Invite link & referral payouts','#referrals']],
    },
    community:{
      who:'The top 3 wallets in each of three categories: creators by finalized settled creator fees, direct referrers by their referred creators’ settled fees, and traders by finalized buy and sell SOL volume. Participation alone does not earn a ranked award.',
      when:'Each standard UTC day closes at 00:00 UTC. Rankings are fixed after that completed window is verified. Fees enter the window in which settlement finalizes. Winners are paid after the snapshot, from the day’s settled creator fees; the cutoff is not an immediate payment promise.',
      receive:'Winning wallets receive SOL automatically after each 00:00 UTC snapshot. No manual claim or recipient signature is required. Each trade may wake ready processing, but cannot pay an unfinished ranking window. Check Daily bonuses for current availability and receipts.',
      conditions:`Each category receives one third of the bonus pool. Within that category, 1st receives ${ranks[0]}%, 2nd ${ranks[1]}% and 3rd ${ranks[2]}%. Unfilled ranks retain their share in the reserve. Only explicitly labeled Devnet QA programs use five-minute ranking windows.`,
      links:[['Bonus rankings, availability & payouts','#bonuses']],
    },
    buyback:{
      who:'The $RICH ecosystem through confirmed supply reduction. This allocation does not distribute SOL or purchased tokens to holder wallets.',
      when:'Funds accumulate until the live aggregate buyback trigger and applicable source-order minimums are met. An enabled executor must also pass market, quote and execution checks. This is condition-based, not a guaranteed hourly, daily or every-trade burn.',
      receive:'There is no claim. The funded process purchases $RICH and burns it. A completed benefit is evidenced by finalized purchase and burn receipts, rather than an allocation or a full progress bar.',
      links:[['Current trigger & burn receipts','#buybacks']],
    },
    agency:{
      who:'Every new coin includes two buyback-and-burn agents. Promotion packages also include X promotion. Coin holders do not claim this allocation as a cash reward.',
      when:`Each buyback agent can execute once at its saved, verified market-cap milestone, paid from the coin’s agent budget. Default milestones are ${milestones}; the coin’s saved values apply. X promotion follows its saved interval, normally at least ${DEFAULT_AGENCY_RULES.promotionIntervalSeconds/3600} hours between billed posts, and is billed only after the post is verified.`,
      receive:'The budget is divided equally across the included agents: two for Standard, three with a promotion package. Existing coins retain their saved selections. Execution also requires an enabled, ready executor; crossing a market-cap milestone alone is not proof of a purchase or burn. Unused budgets stay reserved.',
      links:[['Included agents, rules & receipts','#marketing-agency']],
    },
  };
  // Short card copy: one plain phrase per line. The full rules stay in `rules`.
  const simple={
    creator:{who:'Creator, coin holders and X account, per the coin’s saved split.',
      when:'Holders: every hour. Creator and X account: once fees settle.',
      receive:'Holders get SOL automatically. Creator and X account claim in Rewards.'},
    operations:{who:'richpad.fun.',when:'Each time collected fees are split.',
      receive:'Pays for running and promoting the platform. No claim.'},
    referrals:{who:'Your three-level referral network.',
      when:'Once your referred creators’ fees settle.',
      receive:'Claim in Referrals with your earning wallet.'},
    community:{who:'Top 3 creators, referrers and traders.',
      when:'Every day after 00:00 UTC.',
      receive:'Sent automatically in SOL. No claim.'},
    buyback:{who:'All $RICH holders, through a smaller supply.',
      when:'Each time the buyback pool reaches 5 SOL.',
      receive:'$RICH is bought and burned. Receipts are on Burn $RICH.'},
    agency:{who:'The coin itself.',
      when:`At each market-cap milestone (normally ${milestones}).`,
      receive:'Agents buy and burn the coin; promotion packages add X posts.'},
  };
  const rules=explanations[key];
  return rules?{...rules,...simple[key],rules}:null;
}

// One card per allocation (who · when · how it is received) instead of a 1050px-wide
// table of paragraph cells that needed horizontal scrolling on every screen.
export function feeBenefitDetailsMarkup(rows){
  const cards=rows.map(row=>{
    const detail=feeBenefitExplanation(row.key);if(!detail)return '';
    return '<article class="fee-policy-card" role="listitem" data-fee-benefit="'+escapeHtml(row.key)+'"><header><h4>'+escapeHtml(row.label)+'</h4><b>'+row.percent+'%</b></header><dl>'
      +[['Who',detail.who],['When',detail.when],['How it arrives',detail.receive]].map(([term,text])=>'<div><dt>'+term+'</dt><dd>'+escapeHtml(text)+'</dd></div>').join('')
      +'</dl></article>';
  }).join('');
  return '<div class="fee-policy-cards" role="list" aria-label="Allocation rules">'+cards+'</div>';
}
