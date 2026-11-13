import {currentFeePolicyCopy,bonusCategoryCopy} from '../fees/fee-policy-copy.js';
import {referralRatePresentation} from '../fees/referral-rate-copy.js';
import {pairLaunchPoints} from '../fees/pair-launch-copy.js';

const guides={
  overview:['Build together. Share the rewards.','Explore ways to earn as a creator, eligible holder, trader, or referrer.','Open Rewards to check eligibility, available claims, and payment history.','The current preview uses Devnet test assets.'],
  home:['Explore new coins and community activity.','Use Portfolio for your holdings and launches.','Open Rewards for claims and automatic payouts.'],
  wallet:['Connect your Solana wallet.','Sign a free message to access your private account.','Review any payment separately in your wallet.','Never share your seed phrase or private key.'],
  following:['Favorites saves starred coins to your signed-in account.','Followed wallets and reminders sync to your verified wallet account.','Sign in with the same account on another device to load them.','Following does not place trades for you.'],
  profile:['Connect your wallet to view holdings, launches and activity.','Use filters to find trades, rewards and airdrops.','Open a payment to view its receipt.'],
  portfolio:['View holdings, launched coins and saved items.','Sign in with your wallet to load private records.','For an unfinished trade or launch, check its existing transaction before retrying.'],
  funded:['Hold $RICH until a launched coin migrates to qualify for its airdrop.','Your token share is proportional to eligible $RICH holdings.','Optional promotion packages burn $RICH.','Fee-funded buybacks also buy and burn $RICH.'],
  launch:['Enter the coin name, ticker, image and project details.','Choose fee sharing, an airdrop amount and any optional developer buy.','Review the costs, then approve the launch in your wallet.','Developer purchases are capped at 20%; choose a 6h, 12h, 24h or 48h lock (12h default).'],
  'launch-protections':['A ticker is reserved on richpad.fun for 12 hours after launch.','The initial developer purchase is capped at 20% of supply.','Choose 6h, 12h, 24h or 48h before launch (12h default); saved deadlines cannot be changed.','Zero developer buys need no escrow; existing locks keep their deadlines.','After unlock, tokens transfer automatically to the original creator wallet; arrival requires network confirmation and a healthy delivery service.','Developer token locks do not delay creator SOL earnings.'],
  'launch-plans':['A saved plan does not launch a coin.','Review the current costs and details before signing.','Check any existing transaction before retrying a launch.'],
  tiers:['Standard has no promotion burn.','Paid packages use the burn amount shown before launch.','Paid packages require a description, roadmap and banner.','Launch and network costs still apply.'],
  'tier-verification':['Open a coin to see its saved package.','Paid packages appear after the launch and burn are confirmed.','View the transaction for the burn amount.'],
  promotions:['Choose a package during launch.','Listing an external coin and boosting visibility are separate actions.','Review the displayed cost before signing.','Promotion does not guarantee trading activity.'],
  listing:['Coins launched here appear after confirmation.','Use Get listed for an external coin.','Review its listing cost and approve it in your wallet.','Check a pending payment before paying again.'],
  'coin-pages':['Check the coin’s mint, creator and trading stage.','View its chart, trades and saved fee split.','Use Buy or Sell to review a trade.','Unavailable data appears as “-”.'],
  trading:['Choose Buy or Sell and enter an amount.','Review the quote, slippage and total cost.','Approve the trade in your wallet.','Check the transaction before retrying a pending trade.'],
  'enhanced-page':['Project stories, roadmaps and links come from creators.','Review the coin’s mint and creator before trading.','A paid package adds the features shown in its launch review.'],
  'creator-updates':['Follow creators to find their updates.','Set reminders for scheduled announcements.','Reminders sync to your verified wallet account.','Creator posts describe their plans; they are not payment guarantees.'],
  'creator-fees':['Trading fees are collected and divided using the coin’s saved split.','Open Rewards → Coin creator and select your coin.','Choose Claim creator fees when available.','Approve the claim with the launch creator wallet.'],
  holders:['Choose a coin that shares fees with holders.','Hold through its displayed cutoff.','Eligible wallets receive SOL automatically after checks.','Small pools carry forward; no claim is needed.'],
  'x-rewards':['Open Rewards → X claims.','Sign in with the X account named by the coin.','Link your receiving wallet.','Claim when funded rewards are available.'],
  referrals:['Share your invite link before a creator’s qualifying fees are settled.','Open My referral list to view your three-level network.','Claim available three-level rewards manually in Referrals.','Daily top-referrer bonuses are separate and automatic.'],
  'daily-bonus':['The countdown ends at 00:00 UTC each day.','Today’s top 5 are shown for creators, referrers and traders.','The top 3 in each category win: 50% / 30% / 20%.','Winners receive SOL automatically after rankings and funding are checked.'],
  buyback:['$RICH buybacks normally run when eligible fees reach 5 SOL, or a configured waiting period ends.','The program buys and burns $RICH automatically.','Liquidity and purchase checks must pass first.','View completed burns on Buyback & burn. No claim needed.'],
  'marketing-agency':['New coins include two agents that buy and burn that coin.','Their default market-cap milestones are $100K and $300K.','Each runs automatically when its saved milestone and funding conditions pass.','Open AI Marketing for progress and completed burns.'],
  'airdrop-policy':['At least 3% of each launched coin’s supply is reserved for eligible $RICH holders.','Hold $RICH until that coin migrates.','Your share is proportional to your eligible $RICH holdings at migration.','Tokens are sent automatically after checks. No claim or signature needed.'],
  'reward-actions':['Claim manually: creator fees, X rewards and three-level referral rewards.','Automatic: coin-holder SOL, Daily bonuses and token airdrops.','Open the matching program to see amounts and payment history.'],
  history:['Rewards → History shows SOL payments.','Daily bonuses shows winners and bonus payments.','Airdrops shows launched-token delivery.','Open a receipt to view the completed transaction.'],
  index:['Search by coin name, ticker or mint.','Filter by stage, tier or time window.','Star coins to save them to your account.','Follow wallets to track their available activity.'],
  search:['Search for coins, wallet addresses, creators or transactions.','Use filters and sorting to narrow the results.','Check the mint when names or tickers match.','Unavailable values appear as “-”.'],
  leaderboard:['Choose a category to view its leaders.','Daily bonus rankings reset each UTC day.','Today’s rankings can change until the cutoff.','Payment history shows rewards already paid.'],
  admin:['Sign in with an approved administrator wallet.','Review policy changes before publishing.','Existing coins keep their saved rates.','Inspect payment history and recovery status before taking action.'],
  troubleshooting:['Check the connected wallet and network.','Look for an existing transaction before retrying.','Return to the program to check its payment history.','Report a problem from Profile if you still need help.'],
  verification:['The current preview uses Devnet test assets.','Unavailable amounts appear as “-”.','A pending payment is not a completed payment.','Open a receipt to check the transaction.'],
  notifications:['Save reminders to your verified wallet account.','Open Notifications to view or dismiss them.','Reminders appear while the app is open.','They never trade, claim or move funds for you.'],
  settings:['Sign in to save favorites across devices.','Followed wallets and reminders use your verified wallet account.','Reconnect the same account to load saved items.','Wallet and X accounts have separate sign-ins.'],
  reporting:['Open Profile → Report a problem.','Describe the issue and add public transaction details if useful.','Review the report before sending.','Keep its private access token to check progress.'],
  'capital-flow':['Review the published fee destinations.','Each coin keeps the split saved at launch.','An allocation is not a withdrawable balance.','Open Rewards for your available claims.'],
  analytics:['View platform activity and completed payments.','Use filters to view a selected period.','Collected fees, allocated rewards and received payments are different totals.','Unavailable values appear as “-”.'],
  callouts:['Hold the coin and post your message to call it.','Your holding is checked before the call is published.','Use the coin page to join the discussion.'],
  privacy:['Wallet addresses and on-chain transactions are public.','Review links and details before sharing.','Keep sign-in information and report access tokens private.','Never share a seed phrase or private key.'],
};
const aliases={pair:'paired-launch',pairs:'paired-launch',fees:'fees',bonus:'daily-bonus',airdrop:'airdrop-policy',referral:'referrals',rewards:'reward-actions',claims:'reward-actions',x:'x-rewards',coin:'coin-pages',trade:'trading',promotion:'promotions',pricing:'fees','enhanced-page':'enhanced-page'};
export function guideOutline(id){
  id=aliases[id]||id;
  if(id==='fees'){const copy=currentFeePolicyCopy();return [copy.headline,'Creator fees use the split saved at launch.','Launch, listing and trade costs are shown before you approve.','Only Operations & marketing is the app allocation.'];}
  if(id==='paired-launch')return pairLaunchPoints();
  return guides[id]||null;
}
export const outlineHtml=points=>`<ul class="guidance-outline">${points.map(point=>`<li>${point}</li>`).join('')}</ul>`;
export function conciseFeePoints(kind){
  if(kind==='rates'){const rates=referralRatePresentation();return [rates.levels.map(({level,rate})=>`L${level}: ${rate}%`).join(' · '),`${rates.total}% total of collected creator fees.`,rates.scope];}
  if(kind==='bonus')return [currentFeePolicyCopy().bonus.split('. ')[0]+'.',bonusCategoryCopy(),...guideOutline('daily-bonus')];
  return guideOutline(kind);
}
