import { currentFeePolicyCopy } from '../fees/fee-policy-copy.js';
import {referralRatePresentation} from '../fees/referral-rate-copy.js';
import { serviceFeeGuide } from '../fees/service-fees-client.js';

export const rewardActions = () => [
  ['Creator wallet', 'SOL', 'Creator reviews and signs settlement, funding and the available payout action.', 'The coin’s saved creator-wallet share and finalized collected fees.', '#payments'],
  ['Coin holders', 'SOL', 'Automatic transfer; no holder claim or recipient signature.', 'A funded holder pool, complete finalized holdings and the coin’s eligibility/minimum conditions.', '#payments/holders'],
  ['X account', 'SOL', 'Sign in with the allocated X account, verify the receiving wallet and complete the claim.', 'The launch’s named X identity, an available allocation and verified source funding.', '#payments'],
  ['Referral network', 'SOL', 'No separate recipient claim; creator-approved V3 transfers pay the recorded upline.', 'Qualified collected fees, frozen first-touch attribution and signed payout approval.', '#referrals'],
  ['Daily bonus', 'SOL', 'Automatic transfer to winners; no manual claim or recipient signature.', 'A completed UTC day, verified top-three rankings and exact source funding.', '#bonuses'],
  ['Community airdrop', 'Launched coin tokens', 'Eligible wallets check their proof and claim within the displayed window.', 'Verified token funding and eligibility snapshot; QA cutoffs are identified separately.', '#airdrops'],
];

export function rewardActionsTable() {
  return `<p class="reward-actions-scroll-help" id="reward-actions-scroll-help" hidden>Scroll to see all programs and columns. Swipe, or focus the comparison and use Left/Right and Up/Down arrow keys.</p><div class="daily-bonus-table reward-actions-scroll" role="region" aria-label="Reward actions comparison"><table><thead><tr><th>Program</th><th>Asset</th><th>What you do</th><th>What must be ready</th></tr></thead><tbody>${rewardActions().map(([name, asset, action, required, href]) => `<tr><td><a href="${href}">${name}</a></td><td>${asset}</td><td>${action}</td><td>${required}</td></tr>`).join('')}</tbody></table></div>`;
}

export function referralGuide() {
  return `${referralRatePresentation().guide} First-touch wallet attribution must exist before the qualifying settlement. The upline is frozen at the first qualified settlement; self-referrals and cycles are rejected. No referral recipient claim is required. The creator approves the V3 payout, then finalized transfers appear in the wallet-authenticated referral dashboard.`;
}

export function productHelpTopics() {
  const copy = currentFeePolicyCopy();
  return {
    pricing:{ title:'App fees and launch costs', answer:serviceFeeGuide(), href:'#docs/fees', link:'Review current fees →' },
    coin:{ title:'Coin details', answer:'Check the mint, saved V3 fee policy, creator, trading stage and transaction links. Missing or partial observations are not zero activity.', href:'#docs/coin-pages', link:'Read about coin pages →' },
    trade:{ title:'Trading issues', answer:'Review quote, slippage and maximum spend before signing. If a submission is uncertain, inspect its transaction and balances before retrying. A wallet signature alone is not a successful trade.', href:'#docs/trading', link:'Read trading guidance →' },
    launch:{ title:'Launch receipts', answer:'Verify the mint, V3 fee owner, creator-directed split and any paid-tier burn. The selected package is recorded only after its launch and burn are confirmed.', href:'#docs/launch', link:'Read launch guidance →' },
    promotion:{ title:'Packages & boosts', answer:'Launch promotion tiers use the displayed $FUNDED burn. Paid listings have a separate quoted burn. Directory boosts can use a quoted Devnet SOL payment with a unique memo and Sponsored label. Verify the receipt for the specific action; these payments are separate from creator-fee distributions.', href:'#docs/promotions', link:'Compare promotion receipts →' },
    fees:{ title:'Fees & distribution', answer:`${copy.allocation} ${copy.collection}`, href:'#docs/fees', link:'Read the fee guide →' },
    rewards:{ title:'Automatic or claim?', answer:'Holder SOL and Daily bonuses are automatic after verification. X rewards and community token airdrops require the eligible recipient to claim. Referral recipients do not claim; their transfers require creator approval.', href:'#docs/reward-actions', link:'Compare reward actions →' },
    bonus:{ title:'Daily bonuses', answer:`${copy.bonus} ${copy.bonusFunding}`, href:'#docs/daily-bonus', link:'Read Daily bonus rules →' },
    referral:{ title:'Referral payouts', answer:referralGuide(), href:'#docs/referrals', link:'Read referral guidance →' },
    airdrop:{ title:'Airdrop status', answer:'This pays launched coin tokens, separately from Daily bonus SOL. Check token-vault funding, the verified migration eligibility snapshot, your proof and claim deadline. A labeled Devnet QA cutoff does not prove a real migration.', href:'#docs/airdrop-policy', link:'Read airdrop guidance →' },
    x:{ title:'X claim issues', answer:'Sign in as the X account named by the launch and link the intended recipient wallet. A message signature proves wallet ownership; the payment still needs a finalized transaction and recipient balance change. Check the existing receipt before retrying.', href:'#docs/x-rewards', link:'Read X claim guidance →' },
    buyback:{ title:'Buyback & burn', answer:'The saved buyback share accrues in dedicated program vaults. The normal aggregate trigger is 5 SOL; Devnet QA may use a smaller displayed trigger. A verified market route, liquidity and purchase/burn receipts are required.', href:'#docs/buyback', link:'Read buyback guidance →' },
    history:{ title:'Payment history', answer:'Rewards History combines independently verified SOL payments, including Daily bonuses. Use program/date filters and transaction links. The Daily bonuses page has all-time recipient rankings; your wallet profile has its own reward and claim activity.', href:'#docs/history', link:'Find payment evidence →' },
    following:{ title:'Favorites & Following', answer:'Favorites contains starred tokens. Following shows holdings and trading activity from tracked trader wallets. Follow a wallet to populate it; starring a token only adds it to Favorites.', href:'#docs/following', link:'Read discovery guidance →' },
    admin:{ title:'Admin tools', answer:'The separate Devnet admin page requires an allowlisted wallet signature. Its separate editors version app service prices and the protocol share; issued quotes and existing launch allocations retain their saved terms. Withdrawals require an approved destination and a source-wallet signature.', href:'#docs/admin', link:'Read admin guidance →' },
  };
}

export function productFaqs() {
  const copy=currentFeePolicyCopy();
  return [
    ['service-prices','What does it cost to trade, launch or list?', `<p>${serviceFeeGuide()}</p><a href="#docs/fees">Review service charges and creator fees →</a>`],
    ['assets','Which rewards are SOL, and which are coin tokens?', '<p>Creator-wallet rewards, holder rewards, X rewards, referral payouts and Daily bonuses use <strong>SOL</strong>. Community airdrops use <strong>tokens of the launched coin</strong>. Check the asset and program on each record.</p>'],
    ['fees','How are collected creator fees allocated?', `<p id="fee-policy-faq">${copy.allocation} ${copy.scope}</p><a href="#capital-flow">See the fee split →</a>`],
    ['fee-base','Do these percentages apply to every trade?', '<p>They apply to gross creator fees actually collected through the funded.vip route. They are not percentages of trade volume or all Pump trading fees. The creator-directed 80% is divided according to that coin’s saved wallet, holder and X settings.</p>'],
    ['collection','How does fee collection become a payment?', `<p>${copy.collection}</p><p>A collected fee, settled allocation, funded vault and finalized recipient transfer are separate stages.</p><a href="#docs/creator-fees">Follow collection to payout →</a>`],
    ['holders','How do coin holders receive SOL?', `<p>${copy.holders} Eligible wallets receive SOL automatically; there is no holder claim button. Subminimum funding carries forward. Holding a coin alone does not guarantee eligibility.</p><a href="#docs/holders">Check holder conditions →</a>`],
    ['recipient-actions','How do creators, X accounts, and referrers receive SOL?', '<p>Creators review and sign the available settlement, funding and payout actions. The named X account signs in, links the recipient wallet and claims an available reward. Referral recipients do not submit a claim; creator-approved V3 payouts appear after finalization.</p><a href="#docs/reward-actions">Compare every reward action →</a>'],
    ['bonus','How are Daily bonuses paid?', `<p>${copy.bonus}</p><p>${copy.bonusFunding}</p><a href="#bonuses">Open payout history and all-time top recipients →</a>`],
    ['referrals','Is a Daily referral bonus the same as my referral-network payout?', `<p>No. Ordinary referral levels are tied to a creator’s frozen upline. The Daily referrer category ranks the top three direct referrers for a completed UTC day and pays from the separate Daily bonus pool. ${copy.reserve}</p><a href="#docs/referrals">Read both referral programs →</a>`],
    ['airdrop','How do I receive launched coin tokens?', '<p>Each launch reserves at least 3% of its coin supply for a separate community airdrop. Eligibility uses a verified $FUNDED-holder snapshot associated with that launch’s migration. After funding and proof checks, the eligible wallet claims during the displayed window, normally 90 days. Buying after the snapshot does not create eligibility. Devnet QA cutoffs are labeled separately.</p><a href="#airdrops">Check airdrops →</a>'],
    ['buyback','When does buyback and burn happen?', `<p>${copy.buyback} The normal aggregate trigger is 5 SOL; selected Devnet QA runs can use a smaller displayed trigger. The app buys and burns $FUNDED, not each launched coin.</p><a href="#buybacks">See trigger, last burn and transaction evidence →</a>`],
    ['proof','Why can an allocation appear before I receive anything?', '<p>An allocation is an obligation, not a completed payment. Check funding, eligibility, any required approval or claim, and a finalized receipt showing the recipient balance change. The snapshot countdown marks a cutoff; it does not promise immediate payment.</p><a href="#payments">Check payment history →</a>'],
    ['following','What is the difference between Favorites and Following?', '<p>Favorites shows your starred tokens. Following shows holding and trading activity from trader wallets you track. Star a token to save it; follow a trader wallet to track its activity.</p><a href="#explore">Open Explore →</a>'],
    ['history','Where is my reward and claim history?', '<p>Use Rewards → History for independently verified SOL payouts and filters, Daily bonuses for category rankings and bonus receipts, and your wallet profile for wallet activity, claims, rewards, airdrops and bonuses. Missing coverage is shown separately from zero payments.</p><a href="#docs/history">Find the right history →</a>'],
    ['verified','Are launches and market figures verified?', '<p>Listings use verified records. Market figures use available observations and can be partial or unavailable. Promotions require their matching package-burn or SOL-payment receipt and do not promise liquidity, activity or returns.</p><a href="#docs/promotions">Compare promotion types →</a>'],
    ['wallet','Does funded.vip control my wallet?', '<p>Your connected wallet reviews and signs its own actions. Automatic reward payouts are sent by the program’s payout worker and do not ask recipients to sign. Never provide a seed phrase or private key.</p>'],
    ['migration','What changes when a coin migrates?', '<p>Trading moves from the Pump curve to a pool, and the community token airdrop needs a verified migration eligibility snapshot. Do not infer post-migration fee-collection coverage or claim readiness from a migrated label alone.</p><a href="#docs/airdrop-policy">Review migration evidence →</a>'],
    ['support','Something looks wrong. Where can I ask?', '<p>Open Help for the relevant guide. Record the mint, network, connected wallet, transaction signature and error message. Check the existing transaction before retrying an uncertain submission. The Help panel is guidance, not live messaging.</p><a href="#docs/troubleshooting">Troubleshoot a pending action →</a>'],
  ];
}

export function referralFaqs() {
  const copy=currentFeePolicyCopy();
  return [
    ['referral-rates','What are the referral rates?',`<p>${referralGuide()}</p>`],
    ['referral-qualified','When do rewards become payable?',`<p>${copy.referrals} Creating an account, recruiting or launching without collected fees does not create a payout.</p>`],
    ['referral-claim','Do I need to claim a referral bonus?', '<p>There is no separate V3 recipient claim. Connect and verify the earning wallet to view its private referral dashboard. The launch creator’s approval and a finalized transfer are required before a referral-network reward is paid. Daily referrer bonuses are sent automatically after their daily snapshot and funding checks.</p>'],
    ['referral-missing','What happens when a level is missing?',`<p>${copy.reserve}</p>`],
    ['referral-daily','How do I qualify for the Daily referrer bonus?',`<p>${copy.bonus} ${copy.bonusFunding}</p><a href="#bonuses">See Daily bonus rankings and history →</a>`],
    ['referral-finality','Why does my dashboard show pending or no payout?', '<p>Check first-touch attribution, qualified collections, saved upline, creator settlement and payout approvals, then the finalized receipt. A pending or unavailable proof is not a zero balance or a successful payout. Rewards depend on collected activity and are not guaranteed.</p>'],
  ];
}

export function renderProductFaqs(document=globalThis.document) {
  for(const [selector,items] of [['.home-reference-faq-list',productFaqs()],['#referral-faq .faq-grid',referralFaqs()]]) {
    const root=document?.querySelector(selector); if(!root) continue;
    const open=new Set([...root.querySelectorAll('details[open][data-faq]')].map(row=>row.dataset.faq));
    const first=!root.dataset.guidanceReady;
    root.innerHTML=items.map(([id,title,body],index)=>`<details data-faq="${id}"${open.has(id)||first&&index===0 ? ' open':''}><summary>${title}</summary>${body}</details>`).join('');
    root.dataset.guidanceReady='true';
  }
}
