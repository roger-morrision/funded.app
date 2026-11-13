import { currentFeePolicyCopy } from '../fees/fee-policy-copy.js';
import {referralRatePresentation} from '../fees/referral-rate-copy.js';
import { serviceFeeGuide } from '../fees/service-fees-client.js';
import { pageHelpTopics, pageFaqs } from './page-guidance.js';
import {communityAirdropCopy,communityAirdropGuide} from '../rewards/community-airdrop-copy.js';
import {guideOutline,outlineHtml,conciseFeePoints} from './guide-outlines.js';
import {pairLaunchPoints} from '../fees/pair-launch-copy.js';

export const rewardActions = () => [
  ['Creator wallet', 'SOL', 'Rewards → Coin creator → select coin → Claim creator fees. Sign with the launch creator wallet.', 'Available after the saved wallet share is collected and settled; developer token locks do not delay these SOL earnings.', '#payments/creator'],
  ['Coin holders', 'SOL', 'Automatic; no claim or signature. Check Rewards → Coin holder and payout history.', 'After each completed UTC hour, with a funded pool, verified holdings, prices and minimums; small pools carry forward.', '#payments/holders'],
  ['X account', 'SOL', 'Rewards → X claims. Sign in with the named X account, link the receiving wallet and claim.', 'Available after the named account’s allocation is funded and verified.', '#payments/x'],
  ['Referral network', 'SOL', 'Referrals → Claim reward. Sign in with the earning wallet and sign the allocation’s claim message.', 'Available after qualifying fees are collected and settled; saved first-, second- and third-level shares apply.', '#referrals'],
  ['Daily bonus', 'SOL', 'Automatic for top creators, referrers and traders. Check Daily bonuses for rankings and receipts; no claim.', 'After the UTC day closes at 00:00 UTC and rankings and funding are verified; each category pays its top three.', '#bonuses'],
  ['Community airdrop', 'Launched coin tokens', 'Hold $RICH until migration. Receive tokens automatically; no claim or signature.', 'At least 3% of supply, shared in proportion to eligible $RICH balances at the verified migration snapshot.', '#airdrops'],
];

export function rewardActionsTable() {
  return `<p class="reward-actions-scroll-help" id="reward-actions-scroll-help" hidden>Scroll to see all programs and columns. Swipe, or focus the comparison and use Left/Right and Up/Down arrow keys.</p><div class="daily-bonus-table reward-actions-scroll" role="region" aria-label="Reward actions comparison"><table><thead><tr><th>Program</th><th>Asset</th><th>What you do</th><th>What must be ready</th></tr></thead><tbody>${rewardActions().map(([name, asset, action, required, href]) => `<tr><td><a href="${href}">${name}</a></td><td>${asset}</td><td>${action}</td><td>${required}</td></tr>`).join('')}</tbody></table></div>`;
}

export function referralGuide() {
  return `${referralRatePresentation().guide} First-touch wallet attribution must exist before the qualifying settlement. The upline is frozen at the first qualified settlement; self-referrals and cycles are rejected. Claim three-level referral rewards manually in Referrals after fees are collected and settled: sign in with the earning wallet, choose Claim reward and sign the allocation’s claim message. Daily bonuses for top referrers remain automatic. Inspect the finalized receipt.`;
}

export function productHelpTopics() {
  const copy = currentFeePolicyCopy();
  const topics = {
    ...pageHelpTopics(),
    wallet:{ title:'Wallet connection', answer:'Connect the intended Solana wallet and check the network. A one-use sign-in message authenticates private dashboard access; it is not a payment. Review each financial transaction separately and never provide a seed phrase or private key.', href:'#docs/wallet', link:'Read wallet guidance →' },
    funded:{ title:'The $RICH token', answer:'$RICH is used for optional promotion and listing burns, community-airdrop snapshot eligibility, and the platform buyback-and-burn program. Holding it does not make every SOL reward claimable. Check the mint, network and program-specific evidence.', href:'#docs/funded', link:'Read about $RICH →' },
    leaderboard:{ title:'Leaderboards', answer:'Leaderboards rank the confirmed activity available in the selected view. Callout market-cap samples, Daily bonus rankings, all-time recipients and burn contribution are different measures. A rank or score is not a payout or realized investment return.', href:'#docs/leaderboard', link:'Read ranking guidance →' },
    pricing:{ title:'App fees and launch costs', answer:serviceFeeGuide(), href:'#docs/fees', link:'Review current fees →' },
    coin:{ title:'Coin details', answer:'Check the mint, saved V3 fee policy, creator, trading stage and transaction links. Missing or partial observations are not zero activity.', href:'#docs/coin-pages', link:'Read about coin pages →' },
    trade:{ title:'Trading issues', answer:'Review quote, slippage and maximum spend before signing. If a submission is uncertain, inspect its transaction and balances before retrying. A wallet signature alone is not a successful trade.', href:'#docs/trading', link:'Read trading guidance →' },
    launch:{ title:'Launch receipts', answer:'Verify the mint, V3 fee owner, creator-directed split and any paid-tier burn. The selected package is recorded only after its launch and burn are confirmed.', href:'#docs/launch', link:'Read launch guidance →' },
    promotion:{ title:'Packages & boosts', answer:'Launch promotion tiers use the displayed $RICH burn. Paid listings have a separate quoted burn. Directory boosts can use a quoted Devnet SOL payment with a unique memo and Sponsored label. Verify the receipt for the specific action; these payments are separate from creator-fee distributions.', href:'#docs/promotions', link:'View promotion receipts →' },
    fees:{ title:'Fees & distribution', answer:`${copy.allocation} ${copy.collection}`, href:'#docs/fees', link:'Read the fee guide →' },
    rewards:{ title:'Automatic or claim?', answer:'Holder SOL, Daily bonuses and community token airdrops are automatic after verification. Hold $RICH until migration for a proportional share of the launched-token airdrop. Creator fees, X rewards and three-level referral rewards require manual recipient claims. Open Rewards → Coin creator, Rewards → X claims, or Referrals respectively.', href:'#docs/reward-actions', link:'View reward actions →' },
    bonus:{ title:'Daily bonuses', answer:`${copy.bonus} ${copy.bonusFunding}`, href:'#docs/daily-bonus', link:'Read Daily bonus rules →' },
    referral:{ title:'Referral payouts', answer:referralGuide(), href:'#docs/referrals', link:'Read referral guidance →' },
    airdrop:{ title:'Automatic token airdrops', answer:Object.values(communityAirdropCopy).join(' '), href:'#docs/airdrop-policy', link:'Read airdrop guidance →' },
    x:{ title:'X claim issues', answer:'Sign in as the X account named by the launch and link the intended recipient wallet. A message signature proves wallet ownership; the payment still needs a finalized transaction and recipient balance change. Check the existing receipt before retrying.', href:'#docs/x-rewards', link:'Read X claim guidance →' },
    buyback:{ title:'Buyback & burn', answer:'The saved buyback share accrues in dedicated program vaults. The normal aggregate trigger is 5 SOL; Devnet QA may use a smaller displayed trigger. A verified market route, liquidity and purchase/burn receipts are required.', href:'#docs/buyback', link:'Read buyback guidance →' },
    history:{ title:'Payment history', answer:'Rewards History combines independently verified SOL payments, including Daily bonuses. Use program/date filters and transaction links. The Daily bonuses page has all-time recipient rankings; your wallet profile has its own reward and claim activity.', href:'#docs/history', link:'Find payment evidence →' },
    following:{ title:'Favorites & Following', answer:'Favorites contains starred tokens. Following shows holdings and trading activity from tracked trader wallets. Follow a wallet to populate it; starring a token only adds it to Favorites.', href:'#docs/following', link:'Read discovery guidance →' },
    admin:{ title:'Admin tools', answer:'The separate Devnet admin page requires an allowlisted wallet signature. Its separate editors version app service prices and the separate creator-fee allocations; issued quotes and existing launch allocations retain their saved terms. Withdrawals require an approved destination and a source-wallet signature.', href:'#docs/admin', link:'Read admin guidance →' },
  };
  return Object.fromEntries(Object.entries(topics).map(([id,topic])=>[id,{...topic,points:guideOutline(id)||[topic.answer]}]));
}

export function productFaqs() {
  const copy=currentFeePolicyCopy();
  return [
    ...pageFaqs(),
    ['service-prices','What does it cost to trade, launch or list?', `<p>${serviceFeeGuide()}</p><a href="#docs/fees">Review service charges and creator fees →</a>`],
    ['assets','Which rewards are SOL, and which are coin tokens?', '<p>Creator-wallet rewards, holder rewards, X rewards, referral payouts and Daily bonuses use <strong>SOL</strong>. Community airdrops use <strong>tokens of the launched coin</strong>. Check the asset and program on each record.</p>'],
    ['fees','How are collected creator fees allocated?', `<p id="fee-policy-faq">${copy.allocation} ${copy.scope}</p><a href="#capital-flow">See the fee split →</a>`],
    ['paired-launch','Do coins paired with USDC, xStocks or other tokens use the same fees?', `<p>${pairLaunchPoints().join(' ')}</p><a href="#docs/paired-launch">Read about paired launches →</a>`],
    ['fee-base','Do these percentages apply to every trade?', '<p>They apply to gross creator fees actually collected through the richpad.fun route. They are not percentages of trade volume or all Pump trading fees. The creator-directed 80% is divided according to that coin’s saved wallet, holder and X settings.</p>'],
    ['collection','How does fee collection become a payment?', `<p>${copy.collection}</p><p>A collected fee, settled allocation, funded vault and finalized recipient transfer are separate stages.</p><a href="#docs/creator-fees">Follow collection to payout →</a>`],
    ['holders','How do coin holders receive SOL?', `<p>${copy.holders} Eligible wallets receive SOL automatically; there is no holder claim button. Subminimum funding carries forward. Holding a coin alone does not guarantee eligibility.</p><a href="#docs/holders">Check holder conditions →</a>`],
    ['recipient-actions','How do creators, X accounts, and referrers receive SOL?', '<p>All three require manual claims after their allocations are available. For creator fees, open Rewards → Coin creator, select the coin and choose Claim creator fees. For X rewards, open Rewards → X claims, sign in as the named account and link your wallet. For three-level referrals, open Referrals with the earning wallet and choose Claim reward, then sign its claim message. Inspect the finalized payment receipt.</p><a href="#docs/reward-actions">View every reward action →</a>'],
    ['bonus','How are Daily bonuses paid?', `<p>${copy.bonus}</p><p>${copy.bonusFunding}</p><p>Open Daily bonuses for the snapshot countdown and today’s top five in each category. Only the top three at the verified cutoff win; live positions are provisional.</p><a href="#bonuses">Open payout history and all-time top recipients →</a>`],
    ['referrals','Is a Daily referral bonus the same as my referral-network payout?', `<p>No. Ordinary referral levels are tied to a creator’s frozen upline. The Daily referrer category ranks the top three direct referrers for a completed UTC day and pays from the separate Daily bonus pool. ${copy.reserve}</p><a href="#docs/referrals">Read both referral programs →</a>`],
    ['airdrop','How do I receive launched coin tokens?', communityAirdropGuide()+'<a href="#airdrops">Check automatic airdrops →</a>'],
    ['buyback','When does buyback and burn happen?', `<p>${copy.buyback} The normal aggregate trigger is 5 SOL; selected Devnet QA runs can use a smaller displayed trigger.</p><p>${copy.agency}</p><a href="#buybacks">See $RICH burn receipts →</a> <a href="#marketing-agency">Review launched-coin buyback agents →</a>`],
    ['proof','Why can an allocation appear before I receive anything?', '<p>An allocation is an obligation, not a completed payment. Check funding, eligibility, any required approval or claim, and a finalized receipt showing the recipient balance change. The snapshot countdown marks a cutoff; it does not promise immediate payment.</p><a href="#payments">Check payment history →</a>'],
    ['following','What is the difference between Favorites and Following?', '<p>Favorites shows your starred tokens. Following shows holding and trading activity from trader wallets you track. Star a token to save it; follow a trader wallet to track its activity.</p><a href="#explore">Open Explore →</a>'],
    ['history','Where is my reward and claim history?', '<p>Use Rewards → History for independently verified SOL payouts and filters, Daily bonuses for category rankings and bonus receipts, and your wallet profile for wallet activity, claims, rewards, airdrops and bonuses. Missing coverage is shown separately from zero payments.</p><a href="#docs/history">Find the right history →</a>'],
    ['verified','Are launches and market figures verified?', '<p>Listings use verified records. Market figures use available observations and can be partial or unavailable. Promotions require their matching package-burn or SOL-payment receipt and do not promise liquidity, activity or returns.</p><a href="#docs/promotions">View promotion types →</a>'],
    ['wallet','Does richpad.fun control my wallet?', '<p>Your connected wallet reviews and signs its own actions. Automatic reward payouts are sent by the program’s payout worker and do not ask recipients to sign. Never provide a seed phrase or private key.</p>'],
    ['migration','What changes when a coin migrates?', '<p>Trading moves from the Pump curve to a pool. The migration-time $RICH snapshot fixes eligibility and each wallet’s proportional share of the launched-token airdrop. Delivery is automatic after verification; no recipient claim is needed. A migrated label alone does not prove a completed payout.</p><a href="#docs/airdrop-policy">Review migration airdrops →</a>'],
    ['support','Something looks wrong. Where can I ask?', '<p>Open Help for the relevant guide, or use the reviewed issue-report form in Profile without wallet or X sign-in. Include public context only if you choose, review the exact report, then send. Keep its private status token. Check an existing transaction before retrying an uncertain submission. Help is guidance, not live messaging.</p><a href="#docs/troubleshooting">Troubleshoot a pending action →</a>'],
  ].map(([id,title,body])=>{
    const program={assets:'reward-actions','recipient-actions':'reward-actions','service-prices':'fees',fees:'fees',collection:'creator-fees',holders:'holders',bonus:'daily-bonus',referrals:'referrals',airdrop:'airdrop-policy',buyback:'buyback',following:'following',history:'history',wallet:'wallet',migration:'airdrop-policy',support:'reporting',proof:'verification',verified:'verification'}[id];
    const points=id==='bonus'?conciseFeePoints('bonus'):program&&guideOutline(program);
    if(!points)return [id,title,body];
    const links=[...body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match=>match[0]).join(' ');
    return [id,title,outlineHtml(points)+links];
  });
}

export function referralFaqs() {
  const rates=referralRatePresentation();
  const points=items=>`<ul>${items.map(item=>`<li>${item}</li>`).join('')}</ul>`;
  return [
    ['referral-rates','What are the referral rates?',points([
      rates.levels.map(({level,rate})=>`L${level}: ${rate}%`).join(' · '),
      `${rates.total}% total of collected creator fees.`,rates.scope,
    ])+'<a href="#docs/referrals">Full referral rules →</a>'],
    ['referral-qualified','When do rewards become payable?',points(['Invite creators before their qualifying fees are settled.','Rewards become available after fees are collected and settled.','Signups alone do not earn rewards.'])],
    ['referral-claim','Do I need to claim a referral bonus?',points(['Three-level rewards: claim manually in Referrals.','Sign in with the earning wallet → Claim reward → sign the message.','Daily referrer bonus: paid automatically.'])],
    ['referral-missing','What happens when a level is missing?',points(['Its share stays in the community reserve.','It is not reassigned or added to Daily bonuses.'])],
    ['referral-daily','How do I qualify for the Daily referrer bonus?',points(['Rank in the top 3 by your directly referred creators’ settled fees.','Daily cutoff: 00:00 UTC. Today’s top 5 can change until then.','Category prizes: 1st 50% · 2nd 30% · 3rd 20%.','Paid automatically after rankings and funding are checked.'])+'<a href="#bonuses">View Daily bonuses →</a>'],
    ['referral-finality','Why does my dashboard show pending or no payout?',points(['Your referrals may not have earned qualifying fees yet.','Available three-level rewards need a manual claim.','Check payout history for completed payments.'])],
  ];
}

const faqBodies=new WeakMap();
export function renderProductFaqs(document=globalThis.document) {
  const home=document?.querySelector('.home-reference-faq-list');
  if(home&&!home.querySelector('.home-faq-primary')) home.innerHTML='<div class="home-faq-primary"></div><details class="home-faq-more"><summary>More questions about app pages and flows</summary><div class="home-faq-secondary"></div></details>';
  const faqs=productFaqs(),primary=new Set(['service-prices','assets','recipient-actions','proof']);
  for(const [selector,items] of [['.home-faq-primary',faqs.filter(([id])=>primary.has(id))],['.home-faq-secondary',faqs.filter(([id])=>!primary.has(id))],['#referral-faq .faq-grid',referralFaqs()]]) {
    const root=document?.querySelector(selector); if(!root) continue;
    const existing=new Map([...root.querySelectorAll(':scope > details[data-faq]')].map(row=>[row.dataset.faq,row]));
    const active=document.activeElement,owned=root.contains(active)&&active.getClientRects().length;
    const owner=owned?active.closest('details[data-faq]')?.dataset.faq:null,href=owned&&active.matches('a[href]')?active.getAttribute('href'):null;
    let cancelled=false;const intervention=event=>{if(event.target!==active)cancelled=true;};
    if(owned)document.addEventListener('focusin',intervention,true);
    try{
      let cursor=root.firstElementChild;
      for(const[id,title,body]of items){
        let row=existing.get(id);existing.delete(id);
        if(!row){row=document.createElement('details');row.dataset.faq=id;row.open=false;row.append(document.createElement('summary'));}
        const summary=row.querySelector(':scope > summary');if(summary.textContent!==title)summary.textContent=title;
        if(faqBodies.get(row)!==body){
          for(const child of[...row.childNodes])if(child!==summary)child.remove();
          row.insertAdjacentHTML('beforeend',body);faqBodies.set(row,body);
        }
        if(row!==cursor)root.insertBefore(row,cursor);cursor=row.nextElementSibling;
      }
      for(const child of[...root.children])if(child.tagName!=='DETAILS'||!items.some(([id])=>id===child.dataset.faq))child.remove();
      if(owned&&!cancelled&&document.activeElement===document.body){
        const row=[...root.children].find(row=>row.dataset.faq===owner);
        const next=active.isConnected?active:href&&[...row?.querySelectorAll('a[href]')||[]].find(link=>link.getAttribute('href')===href)||row?.querySelector('summary');
        next?.focus({preventScroll:true});
      }
      root.dataset.guidanceReady='true';
    }finally{if(owned)document.removeEventListener('focusin',intervention,true);}
  }
}
