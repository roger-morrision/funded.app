// Shared page explanations for Docs, Questions and the Help center.
import {guideOutline,outlineHtml} from './guide-outlines.js';
// Describe implemented behavior; runtime availability and saved terms still govern.
const guide=(id,title,question,answer,steps,href,link)=>({id,title:id==='settings'?'Account settings':title,question:id==='settings'?'Where are my favorites, follows and reminders saved?':question,answer:guideOutline(id)?.join(' ')||answer,steps,href,link});
export const pageGuides=[
  guide('home','Home and getting around','Where should I start?',
    'Home shows launches, observed activity, reward allocations and next steps. Explore finds coins; Portfolio shows your holdings and projects; Rewards separates automatic payments from claims. Use the left menu on desktop or open the menu drawer on a phone.',
    ['Check the network label before connecting or signing. Devnet uses test assets. A Mainnet read-only preview does not enable transactions.',
      'Home allocations and countdowns describe recorded funding or processing windows. Open receipts to check completed payments; a service status alone cannot prove a payout.',
      'Use Docs for searchable guides. Open Help for this page in the menu for a relevant answer; desktop pages also offer a floating Help button.'], '#overview','Open Home'),
  guide('search','Search and discovery','What can I search for?',
    'Global search accepts tokens, recorded creator wallets, public wallet addresses, transaction signatures and available creator names or handles. Explore adds time, stage and tier filters, sorting and grid/table views. Check the mint when names or tickers look alike.',
    ['Use the arrow keys and Enter to open a search result. Escape closes search.',
      'Observed volume, market cap and chart coverage can be partial or stale. Read timestamps and coverage; an unavailable source is not zero activity.',
      'Favorites saves starred tokens. Following tracks selected wallets and available creator updates; it never authorizes copy trading.'], '#explore','Open Explore'),
  guide('portfolio','Portfolio and recovery','How do I read Portfolio and resume an unfinished action?',
    'Connect the intended wallet in Portfolio to inspect holdings, created coins and recorded activity. Portfolio pricing and profit/loss use the displayed observations and cost-basis coverage; they may not represent complete wallet profit.',
    ['Open a coin to inspect its balance, market source and available actions. Public profiles and private authenticated records have different coverage.',
      'Recovery keeps public launch and trade references scoped to the wallet. Check an existing signature before retrying an uncertain submission; a timeout is not a finalized failure.',
      'If device storage is unavailable, recovery can be temporary in this tab. Preserve the public signature before closing it. No private keys are saved by this recovery feature.'], '#my-launches','Open Portfolio'),
  guide('launch-protections','Launch protections and developer tokens','How do ticker protection and developer locks work?',
    'funded.vip prevents reuse of a ticker for 12 hours on this app, ignoring capitalization. New launches lock the declared initial developer token purchase for the selected 6h, 12h, 24h or 48h period on-chain (12h by default). Creator SOL earnings have no 12-hour hold; normal funding and payout conditions still apply.',
    ['The initial developer purchase is capped at 20% of supply. Its lock is part of the creation transaction; a zero developer purchase needs no escrow.',
      'After unlock, use the coin page release action and verify the finalized token transfer. Existing launches are not retroactively locked. Later purchases, other wallets and extra tokens sent to escrow are outside the original locked allocation.',
      'Ticker protection does not reserve names across Solana. Bundle-wallet signals have bounded coverage and can flag shared funding or timing; they do not prove common ownership or prevent selling.',
      'The lock program is upgradeable. These protections do not guarantee a safe investment or an independent security audit.'], '#launch','Review launch protections'),
  guide('launch-plans','Launch drafts and completion','Does saving a launch plan launch my coin automatically?',
    'A saved launch plan is a public draft and a return reminder. It does not reserve a mint or ticker, schedule a transaction, or authorize signing. Resume the plan, restore artwork, obtain fresh quotes and review the final launch before approving it.',
    ['Review identity, package, story, image, creator-directed split, community reserve, initial developer purchase and the full SOL/token budget. Paid promotion packages require the displayed project fields and banner.',
      'A launch may require setup before the atomic creation transaction. Network or rent costs from successful setup can remain if creation later fails.',
      'After confirmation, use the completion checklist to inspect the mint, saved policy, reserve status, payments and included agents. Open the mint-specific airdrop link to check eligibility and custody.'], '#launch','Open Create a coin'),
  guide('listing','Get listed and listing recovery','Do I pay again to list a coin launched here?',
    'Listing is included for a verified funded.vip launch. For an external coin, Get listed checks the exact mint and metadata, then offers the current quoted $FUNDED burn when eligible. Listing, launch promotion packages and directory SOL boosts have separate terms and receipts.',
    ['Paste the mint on the selected network and inspect its identity and included-listing status. A failed metadata read does not prove an included launch owes a new listing fee.',
      'For a paid listing, review the quoted burn, expiry and wallet before signing. A matching finalized burn is required and cannot be reused for another listing.',
      'If confirmation is uncertain, retain and verify the existing transaction before another payment. Listing does not change the saved creator-fee split.'], '#list','Open Get listed'),
  guide('marketing-agency','AI Marketing and coin buybacks','How do the AI agents differ from the $FUNDED buyback?',
    'Every new launch includes two agents that buy and burn the launched coin. Promotion packages also include X promotion. Included agents share the separate AI marketing allocation equally. The platform $FUNDED buyback uses its own allocation and buys a different asset.',
    ['Default own-coin milestones are $100,000 and $300,000 verified USD market cap, once per agent per mint. Inspect the saved thresholds and budgets; future admin changes do not rewrite existing coins.',
      'X promotion uses the saved cadence, at least 24 hours by default, and is billed only after verified delivery. Account limits, content review and publisher availability can delay it. A launch announcement is separate from recurring agency promotion.',
      'The page separates published policy, funded budgets, worker readiness and completed receipts. X publishing can be paused while buyback workers remain independently available.',
      'A milestone, quote or queued action is not a completed burn or post. Liquidity, protected spending, fresh market evidence and finalized purchase/burn proof remain required.'], '#marketing-agency','Open AI Marketing'),
  guide('callouts','Callouts and token chat','How do I make a callout, and what do its rankings mean?',
    'Choose a coin from Callouts or open its Chat tab. Sign in as required and post a message. Verified token holders can create a call; other messages remain chat. Calls are limited to ten per hour and one per coin every 30 minutes.',
    ['Filter All, Hot or Mine and inspect Latest, Top callers and Conviction. Conviction means the caller held the coin when making the call; it does not establish continued ownership.',
      'Caller rankings use the displayed sampled market-cap observations, mean observed peak, sample size and hit counts. Multiples are not realized wallet returns or guaranteed performance.',
      'Read the caller profile, observation timestamp and Devnet context. If chat is unavailable, keep your draft and retry after checking status.'], '#callouts','Open Callouts'),
  guide('creator-updates','Creator profiles and updates','Are creator stories and updates independently verified?',
    'Creator profiles can show public project details, versioned briefs, updates and recorded wallet delivery facts. Signing in verifies control of an account; it does not independently verify its story, roadmap or promises.',
    ['Follow creators to see available published updates. Apply buffered feed updates when ready; missing index coverage can limit the feed.',
      'Creators review communication drafts before publishing. Editing a draft does not post to X or move funds. Scheduling depends on the available API and still requires the displayed review.',
      'Creator account controls can exclude a page and block new support launches. Existing finalized receipts and entitlements remain recorded.'], '#profile','Open account tools'),
  guide('notifications','Notifications and reminders','Will reminders trade or claim for me?',
    'Activity notices and return reminders are device-local while the app is open. Choose activity types, a minimum SOL receipt amount, digest grouping and local quiet hours. These preferences affect notices, not eligibility, payments or transaction authorization.',
    ['Ready approvals and published cutoff notices link to the relevant action. A reminder does not reserve a launch, submit an order or claim a reward.',
      'Quiet hours use device-local time; Daily bonus windows use UTC. A cutoff is not a guaranteed payout time.',
      'Following a wallet or saving a trade intent never enables automated or delegated trading. Reopen the action and review current terms before signing.'], '#profile','Manage notifications'),
  guide('settings','Account settings and preference backup','What is saved on my device or X account?',
    'Profile separates local preferences, public activity and optional X account sync. Export follows and reminders, or review an imported merge before applying it. Loading saved account preferences never imports them automatically.',
    ['Optional save/load requires a verified X session and a supporting API. Check the account name before saving. Wallet identity and X identity remain separate.',
      'Preference transfer covers supported public wallet follows, creator follows and reminders. It does not back up keys, every setting, artwork or financial recovery records.',
      'Saved slippage and estimated transaction-fee caps are checked at trade review and before submission. Unreadable limits or unknown required fees can block signing; rent and trade spending are separate.'], '#profile','Open Profile settings'),
  guide('reporting','Help center and issue reports','How can I report a problem or request a feature?',
    'Help provides guides and answers; it is not live chat. In Profile, use Report a problem or suggest an improvement. No wallet or X sign-in is required. Choose a category, describe the issue, optionally include public page/transaction details, then review the exact report before sending.',
    ['Report links beside a failed step can carry its public operation context. Context is included only when you opt in. Never include credentials, seed phrases, private keys or private account data.',
      'Choose Review report, then Send reviewed report. Changes require a new review. A received report is not a promise of a response time or financial recovery.',
      'Keep the report reference and private access token for status checks. If storage is unavailable, save them privately when shown. Do not share the token in public.',
      'When the report service is unavailable, copy the reviewed text locally. An uncertain send should be checked before submitting again.'], '#profile','Open issue reporting'),
  guide('capital-flow','Capital flow calculator','Does the calculator show money I can withdraw?',
    'Capital flow illustrates the currently published creator-fee allocation. Its input represents gross collected creator fees, not trade volume. The creator-directed portion follows each coin’s saved wallet, holder and X split; only Operations & marketing is the app allocation.',
    ['Inspect the saved policy for an existing coin. A changed new-launch policy does not reprice its collections or old settlements.',
      'Collection, settlement, vault funding and recipient payment are separate stages. Do not add those stages together as revenue.',
      'Completed-window rankings are separate from the calculator. Open Daily bonuses for finalized payout history and all-time recipients.'], '#capital-flow','Open Capital flow'),
  guide('analytics','Analytics and financial activity','Why do Analytics, receipts and balances show different totals?',
    'Analytics summarizes indexed platform evidence with its displayed coverage. Financial activity separates completed, pending and failed operations. A current vault balance, an allocation, gross rewards and net received SOL measure different things.',
    ['Inspect exact receipts, source collections, token units, fee/rent details and recipient balance changes. Missing net amounts or proof remain unavailable.',
      'Market volume covers observed activity in the stated window; some registered tokens trade through other apps. It is not necessarily funded.vip-originated volume.',
      'Worker heartbeats describe current readiness. Historical receipts describe past execution. Neither alone proves that every balance or pending obligation has been reconciled.'], '#analytics-detail','Open Analytics'),
  guide('privacy','Privacy and public sharing','What should I check before sharing a page or receipt?',
    'Wallet addresses and finalized Solana transactions are public. Sharing a coin, profile or receipt can expose those public identifiers. Review the exact content and destination before sharing; a connected wallet does not authorize a public post.',
    ['Device preferences, private dashboards, issue access tokens and verified-X account settings have separate access boundaries. Do not paste them into public chat or reports.',
      'Optional measurement uses its displayed consent controls. Local notice preferences and quiet hours do not remove public on-chain history.',
      'Read Privacy, Terms and Disclosures for product limits. Changing account visibility does not erase finalized transactions or saved financial entitlements.'], '#privacy','Read Privacy'),
];

export const pageDocumentationTopics=()=>pageGuides.map(({id,title,answer,steps,href,link})=>({
  id,title,body:guideOutline(id)?outlineHtml(guideOutline(id)):`<p>${answer}</p><ol>${steps.map(step=>`<li>${step}</li>`).join('')}</ol>`,href,link,
}));
export const pageHelpTopics=()=>Object.fromEntries(pageGuides.map(({id,title,answer})=>[
  id,{title,answer,href:`#docs/${id}`,link:'Read the full guide →'},
]));
export const pageFaqs=()=>pageGuides.map(({id,question,answer})=>[
  `page-${id}`,question,`${guideOutline(id)?outlineHtml(guideOutline(id)):`<p>${answer}</p>`}<a href="#docs/${id}">Read the guide →</a>`,
]);

export function helpTopicForLocation({pathname='/',hash=''}={}) {
  const [route,detail]=hash.replace(/^#/, '').split('/');
  if(route==='docs'&&detail){
    if(pageGuides.some(guide=>guide.id===detail))return detail;
    const guides={overview:'home',wallet:'wallet',following:'following',profile:'portfolio',funded:'funded',
      launch:'launch',tiers:'promotion','tier-verification':'promotion',promotions:'promotion','coin-pages':'coin',
      trading:'trade','enhanced-page':'creator-updates',fees:'fees','creator-fees':'fees','reward-actions':'rewards',
      holders:'rewards','x-rewards':'x',referrals:'referral','daily-bonus':'bonus',buyback:'buyback',
      'airdrop-policy':'airdrop',claims:'rewards',history:'history',index:'search',leaderboard:'leaderboard',
      admin:'admin',troubleshooting:'reporting',verification:'rewards',faq:'home'};
    if(guides[detail])return guides[detail];
  }
  if(route==='payments'&&detail){
    const programs={x:'x',history:'history',creator:'fees',holders:'rewards'};
    if(programs[detail])return programs[detail];
  }
  const routes={overview:'home',explore:'search',community:'following',following:'following',
    launch:'launch',list:'listing','my-launches':'portfolio',payments:'rewards',referrals:'referral',
    'referral-faq':'referral',airdrops:'airdrop',bonuses:'bonus',buybacks:'buyback',
    'capital-flow':'capital-flow','analytics-detail':'analytics',leaderboard:'leaderboard',
    'marketing-agency':'marketing-agency',callouts:'callouts',
    profile:'settings','creator-settings':'creator-updates',privacy:'privacy',terms:'privacy',
    disclosures:'rewards',paid:'funded',docs:'home'};
  if(routes[route])return routes[route];
  if(/^\/(token|launch\/coin)\//.test(pathname))return 'coin';
  if(/^\/wallet\//.test(pathname))return 'portfolio';
  if(/^\/creator\//.test(pathname))return 'creator-updates';
  if(/^\/admin(?:\/|$)/.test(pathname))return 'admin';
  if(/^\/list\/?$/.test(pathname))return 'listing';
  if(/^\/funded\/?$/.test(pathname))return 'funded';
  if(/^\/explore\/?$/.test(pathname))return 'search';
  if(/^\/pilot\/?$/.test(pathname))return 'launch';
  return 'home';
}
