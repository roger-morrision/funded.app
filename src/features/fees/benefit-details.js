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
      who:'Every new coin includes two buyback-and-burn agents. Promotion packages also include X promotion. Coin holders do not claim this allocation as a cash reward.',
      when:`Each buyback agent can execute once at its saved, verified market-cap milestone, after funding and execution checks pass. Default milestones are ${milestones}; the coin’s saved values apply. X promotion follows its saved interval, normally at least ${DEFAULT_AGENCY_RULES.promotionIntervalSeconds/3600} hours between billed posts, and is billed only after the post is verified.`,
      receive:'The budget is divided equally across the included agents: two for Standard, three with a promotion package. Existing coins retain their saved selections. Execution also requires an enabled, ready executor; crossing a market-cap milestone alone is not proof of a purchase or burn. Unused budgets stay reserved.',
      links:[['Included agents, rules & receipts','#marketing-agency']],
    },
  };
  const simple={
    creator:{who:'The creator, eligible coin holders and the X account chosen in the coin’s saved split.',
      when:'Creator: after payout approval and confirmation. Holders: hourly when eligible and funded. X account: when a funded claim is ready.',
      receive:'Creators approve their payout. Holders receive SOL automatically. The named X account must sign in, link a wallet and claim.'},
    operations:{who:'funded.vip’s operations and marketing.',when:'When collected creator fees are split.',
      receive:'No user payout or claim. This share pays for running and promoting the platform.'},
    referrals:{who:'Wallets in the creator’s three-level referral network.',
      when:'After the creator approves a funded payment and it is confirmed. Signups and clicks alone do not earn rewards.',
      receive:'Invite creators before they qualify. Receive SOL in your wallet; no claim needed.'},
    community:{who:'Top 3 wallets in each group: creators, referrers and traders.',
      when:'After each UTC day closes at 00:00 UTC and rankings and funds are checked.',
      receive:'Winners receive SOL automatically when payouts are enabled. No claim or signature needed.'},
    buyback:{who:'No direct wallet payment. This share reduces the $FUNDED supply.',
      when:'When fee targets are met, buybacks are enabled and trade checks pass. No fixed schedule.',
      receive:'The app buys $FUNDED and burns it. Check the finalized receipts; no claim is needed.'},
    agency:{who:'Every new coin includes two coin buyback-and-burn agents. X promotion is included with a promotion package.',
      when:`Buybacks run once at the saved milestones (normally ${milestones} market cap), when funded and ready. X posts are normally at least ${DEFAULT_AGENCY_RULES.promotionIntervalSeconds/3600} hours apart.`,
      receive:'Included agents share the budget equally. X posts are charged only after verification. Unused budgets stay reserved.'},
  };
  const rules=explanations[key];
  return rules?{...rules,...simple[key],rules}:null;
}

export function feeBenefitDetailsMarkup(rows){
  return `<dl>${rows.map(row=>{
    const detail=feeBenefitExplanation(row.key);if(!detail)return '';
    const fields=[['Who receives it',detail.who],['When it is received',detail.when],['How to receive it',detail.receive]];
    const rules=detail.rules,fullFields=[['Who receives it',rules.who],['When it is received',rules.when],['How to receive it',rules.receive],...(rules.conditions?[['Eligibility & amounts',rules.conditions]]:[])];
    const facts=rows=>rows.map(([label,value])=>`<li><strong>${label}</strong><span>${escapeHtml(value)}</span></li>`).join('');
    const fullRules=`<details class="fee-benefit-rules"><summary>Full rules</summary><div class="fee-benefit-rule-body"><p class="fee-benefit-purpose">${escapeHtml(row.benefit)}</p><ul class="fee-benefit-facts">${facts(fullFields)}</ul></div></details>`;
    return `<div class="fee-benefit-detail" data-fee-benefit="${escapeHtml(row.key)}"><dt>${row.percent}% · ${escapeHtml(row.label)}</dt><dd><ul class="fee-benefit-facts">${facts(fields)}</ul>${fullRules}<nav class="fee-benefit-links" aria-label="${escapeHtml(row.label)} details">${detail.links.map(([label,href])=>`<a href="${href}">${escapeHtml(label)} →</a>`).join('')}</nav></dd></div>`;
  }).join('')}</dl><details class="fee-benefit-rules fee-benefit-separate"><summary>Separate community token airdrops</summary><div class="fee-benefit-rule-body"><p>These use the launched coin’s reserved tokens, rather than this SOL fee split. Eligible $FUNDED-holder wallets need a verified eligibility snapshot and a funded, active drop, then claim within its saved window (normally ${DEFAULT_AGENCY_RULES.communityWindowSeconds/86400} days). Standard snapshots are tied to migration; explicitly labeled Devnet QA drops may use a separate QA cutoff. Holding $FUNDED is different from holding this coin for its holder SOL rewards.</p></div></details><p>Timing does not guarantee payment. Rewards need an enabled program, enough funds, any required approval or claim, and a finalized receipt.</p>`;
}
