import { mountHolderAirdropDirectory } from '../rewards/holder-airdrop-directory.js';
import './airdrop-discovery.css';
import { text, $, node, $$, disclose } from './dom.js';
import airdropWolfDropUrl from '../../../airdrop-wolf-drop.webp';
import { mountDocsReference } from '../../../docs-reference.js';

export function secondaryPages() {
  text('#referral-command-title', 'Your referral activity');
  disclose($('.referral-toolkit'), 'Campaign links and sharing tools');
  const receipts=$('.burn-receipts-panel');
  if(receipts)receipts.prepend(node('p','field-help','This history shows confirmed burns available to funded.vip. Total supply can include other burns.'));
  disclose($('.burn-policy-preview'), 'Fee-funded buyback policy · example calculator');
  const airdrops=$('#airdrops');
  if(airdrops){
    const group=(name,selectors,open=false)=>{const panel=node('section','airdrop-workspace');for(const selector of selectors){for(const item of $$(selector,airdrops))panel.append(item);} if(!panel.childElementCount)return; airdrops.append(panel);return disclose(panel,name,{open});};
    const heading=$(':scope > .section-heading',airdrops);
    const intro=$('.airdrop-intro',airdrops);
    const back=node('a','airdrop-back','← Back to home');back.href='#overview';
    heading?.before(back);
    const walletGate=node('section','airdrop-wallet-gate');
    walletGate.setAttribute('aria-label','Wallet eligibility');
    walletGate.innerHTML='<div class="airdrop-wallet-gate-top"><span>Your airdrops</span><strong>Not connected</strong></div><div class="airdrop-wallet-gate-body"><span class="airdrop-wallet-art" aria-hidden="true">◈</span><h3>Check your airdrops</h3><p>Connect the wallet that held $FUNDED at a launch’s snapshot to see its eligibility and claim status.</p><button type="button" class="primary-button">Connect wallet</button></div>';
    walletGate.querySelector('button').addEventListener('click',()=>$('#connect-button')?.click());
    const fundedBalance=$('#airdrop-funded-balance',airdrops);
    if(fundedBalance)walletGate.querySelector('button').before(fundedBalance);
    const heroLayout=node('div','airdrop-hero-layout');
    const heroArt=node('figure','airdrop-hero-art');
    heroArt.innerHTML=`<img src="${airdropWolfDropUrl}" alt="A black wolf watching a descending community supply parcel" loading="lazy" />`;
    intro?.after(heroLayout);
    heroLayout.append(walletGate,heroArt);
    const syncAirdropWallet=()=>{const address=document.documentElement.dataset.connectedWallet;walletGate.querySelector('.airdrop-wallet-gate-top strong').textContent=address?`${address.slice(0,4)}…${address.slice(-4)}`:'Not connected';walletGate.querySelector('h3').textContent=address?'Wallet connected':'Check your airdrops';walletGate.querySelector('p').textContent=address?'Select a launch below to check your allocation based on your $FUNDED balance at its snapshot.':'Connect the wallet that held $FUNDED at a launch’s snapshot to see its eligibility and claim status.';walletGate.querySelector('button').hidden=Boolean(address);};
    window.addEventListener('funded:reward-identity-change',syncAirdropWallet);syncAirdropWallet();
    const publicPrograms=node('section','airdrop-public-programs');
    publicPrograms.innerHTML='<div class="airdrop-reference-tabs" role="tablist" aria-label="Launch airdrop status"><button type="button" role="tab" aria-selected="true" data-public-airdrop-tab="all">All <span>—</span></button><button type="button" role="tab" aria-selected="false" data-public-airdrop-tab="claiming">Claims open <span>—</span></button><button type="button" role="tab" aria-selected="false" data-public-airdrop-tab="curve">On curve <span>—</span></button></div><p class="airdrop-stage-help">Token allocations for eligible $FUNDED wallets. Claims open after a verified migration snapshot.</p>';
    for(const selector of ['.airdrop-directory-head','.airdrop-directory','#airdrop-directory-pagination','#airdrop-selected-program']){const item=$(selector,airdrops);if(item)publicPrograms.append(item);}
    heroLayout.after(publicPrograms);
    text('.airdrop-directory-head h2','Airdrop for $FUNDED holders');
    const directoryHead=$('.airdrop-directory-head',publicPrograms);
    directoryHead?.classList.add('airdrop-directory-heading');
    const toolbar=node('div','airdrop-discovery-toolbar');
    toolbar.append($('.airdrop-reference-tabs',publicPrograms),$('.airdrop-directory-tools',publicPrograms));
    publicPrograms.prepend(directoryHead,toolbar);
    mountHolderAirdropDirectory(publicPrograms);
    const directory=$('#airdrop-directory',publicPrograms);
    directory?.setAttribute('role','tabpanel');
    for(const button of $$('[data-public-airdrop-tab]',publicPrograms)){button.id=`airdrop-${button.dataset.publicAirdropTab}-tab`;button.setAttribute('aria-controls','airdrop-directory');}
    let selectedPublicTab='all';
    const syncPublicPrograms=()=>{
      const all=Number(directory?.dataset.allCount||0);
      const claiming=Number(directory?.dataset.claimingCount||0);
      const curve=Number(directory?.dataset.curveCount||0);
      for(const button of $$('[data-public-airdrop-tab]',publicPrograms)){
        const active=button.dataset.publicAirdropTab===selectedPublicTab;
        button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
        button.querySelector('span').textContent=directory?.dataset.indexStatus==='ready'?String(button.dataset.publicAirdropTab==='all'?all:button.dataset.publicAirdropTab==='claiming'?claiming:curve):'—';
      }
      directory?.setAttribute('aria-labelledby',`airdrop-${selectedPublicTab}-tab`);
    };
    const selectPublicTab=status=>{selectedPublicTab=status;syncPublicPrograms();document.dispatchEvent(new CustomEvent('funded:airdrop-directory-status',{detail:{status}}));};
    publicPrograms.addEventListener('click',event=>{const button=event.target.closest('[data-public-airdrop-tab]');if(!button)return;selectPublicTab(button.dataset.publicAirdropTab);});
    publicPrograms.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||!event.target.matches('[data-public-airdrop-tab]'))return;event.preventDefault();const buttons=$$('[data-public-airdrop-tab]',publicPrograms);const next=buttons[(buttons.indexOf(event.target)+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length];selectPublicTab(next.dataset.publicAirdropTab);next.focus();});
    if(directory)new MutationObserver(syncPublicPrograms).observe(directory,{childList:true});
    syncPublicPrograms();
    const evidence=node('section','airdrop-evidence');evidence.innerHTML='<h2>Airdrop details</h2>';
    for(const selector of ['#airdrop-summary-kpis','.community-airdrop-callout']){const item=$(selector,airdrops);if(item)evidence.append(item);}
    ($('#holder-airdrop-programs') || publicPrograms).after(evidence);
    const flow=$('.claim-flow',airdrops);
    if(flow){flow.classList.add('airdrop-reference-flow');const heading=node('div','airdrop-allocation-heading');heading.innerHTML='<p class="eyebrow">HOW ALLOCATION WORKS</p><h2>From holding to claiming</h2>';evidence.after(heading);heading.after(flow);}
    group('More airdrop details',['.airdrop-detail-grid','.airdrop-wallets-card','.airdrop-enhancement-grid']);
  }
  const leaderboard=$('#leaderboard');
  if(leaderboard){const note=node('p','source-note','Rankings use confirmed activity available in the current feed.');note.id='leaderboard-source-note';$('.leaderboard-hero',leaderboard)?.after(note);}
  const walletPage=$('#wallet-page');
  if(walletPage&&!$('.wallet-profile-kicker',walletPage))$('.wallet-detail-title',walletPage)?.before(node('p','wallet-profile-kicker','WALLET ACTIVITY'));
  const docs=$('#docs');
  if(docs) mountDocsReference(docs);
  const account=$('#profile');
  if(account){const links=node('nav','workspace-shortcuts');links.setAttribute('aria-label','Account tools');links.innerHTML='<a href="#creator-settings"><strong>Linked X account</strong><span>Creator identity and preferences</span></a><a href="#payments"><strong>Rewards & receipts</strong><span>Review the connected wallet’s activity</span></a>';account.append(links);}
}

export function protocolPage() {
  const root = $('#paid');
  if (!root || $('.paid-reference-hero', root)) return;
  const policyContent = [...root.children];
  const hero = node('div', 'paid-reference-hero');
  hero.innerHTML = '<span class="paid-hero-mark" aria-hidden="true">ƒ</span><div><p class="eyebrow">$FUNDED · network token</p><h1>The token behind every launch</h1><p>$FUNDED connects launch tiers, community allocations, and the published burn policy. Verify holder rewards and burns through their receipts.</p><div class="paid-hero-actions"><a class="primary-button" href="#buybacks">Buy or burn $FUNDED ↗</a><a class="secondary-button" id="funded-token-chart" href="#explore" hidden>View on Solana ↗</a><a class="secondary-button" href="#explore">Explore launches</a><a class="secondary-button" href="#launch">Burn for a tier</a></div></div>';
  const facts = node('div', 'paid-reference-metrics');
  facts.setAttribute('aria-label', '$FUNDED token and tier metrics');
  facts.innerHTML = '<div><span>PRICE</span><strong id="funded-token-price">$—</strong><small id="funded-token-price-note">Verified quote unavailable</small></div><div><span>MARKET CAP</span><strong id="funded-token-market-cap">$—</strong><small id="funded-token-market-cap-note">Verified market unavailable</small></div><div><span>$FUNDED BURNED</span><strong id="funded-token-burned">—</strong><small id="funded-token-burned-note">Checking on-chain supply</small></div><div><span>PRO TIER</span><strong id="funded-token-pro">—</strong><small id="funded-token-pro-note">$FUNDED burn per launch</small></div><div><span>PREMIER TIER</span><strong id="funded-token-premier">—</strong><small id="funded-token-premier-note">$FUNDED burn per launch</small></div>';
  const story = node('div', 'funded-token-story');
  story.innerHTML = '<article><h2>What it does here</h2><p>Teams can choose a paid launch tier by burning $FUNDED. The tier and amount are recorded with the launch, and the badge only appears after verification.</p><p>The burn receipt can be checked on-chain; a tier is a promotion signal, not a promise of liquidity or returns. The free Standard tier remains available.</p></article><article><h2>Why holding it matters</h2><p>Funded launches reserve community tokens for eligible $FUNDED holders. Eligibility, funding, and delivery are shown through their own records.</p><p>A policy allocation alone is not a completed airdrop. <a href="#airdrops">Review airdrops →</a></p></article><article><h2>The story</h2><p>Funded.vip links launches, creator fee routes, community rewards, and token burns in one place.</p><p>The published fee policy assigns a protocol share to operations, referrals, community, and a $FUNDED buyback and burn program. <a href="#capital-flow">Follow the fee route →</a></p></article>';
  const contract = node('div', 'funded-token-contract');
  contract.innerHTML = '<span>CONTRACT</span><code id="funded-token-mint">Mint not configured</code><button type="button" id="funded-token-copy" class="secondary-button" disabled>COPY</button>';
  const policy = node('details', 'funded-policy-details');
  const policySummary = node('summary', '', 'Read the full fee route policy');
  policy.append(policySummary, ...policyContent);
  const footer = node('footer', 'funded-token-footer');
  footer.innerHTML = '<div><a class="funded-token-footer-brand" href="#overview"><span aria-hidden="true">ƒ</span> funded.vip</a><p>Launches, rewards, and market activity on Solana with a route you can inspect.</p></div><nav aria-label="Funded protocol"><strong>PROTOCOL</strong><a href="#launch">Launch</a><a href="/funded" aria-current="page">$FUNDED</a><a href="#buybacks">Burn $FUNDED</a><a href="#explore">Explore</a><a href="#airdrops">Airdrops</a><a href="#docs">Docs</a></nav><nav aria-label="Legal"><strong>LEGAL</strong><a href="#privacy">Privacy</a><a href="#terms" data-info="terms">Terms</a><a href="#disclosures" data-info="disclosures">Disclosures</a><a href="#opt-out" data-info="opt-out">Opt out</a></nav><small>© 2026 FUNDED.VIP · POWERED BY $FUNDED</small>';
  root.append(hero, facts, story, contract, policy, footer);
  const tape = node('aside', 'funded-token-tape');
  tape.setAttribute('aria-label', 'Verified Solana token figures');
  tape.innerHTML = '<div id="funded-token-tape-items"><span>Checking verified Solana figures…</span></div>';
  document.body.append(tape);
  $('#funded-token-copy')?.addEventListener('click', async () => {
    const mint = $('#funded-token-copy')?.dataset.mint;
    if (!mint) return;
    try { await navigator.clipboard.writeText(mint); $('#funded-token-copy').textContent = 'COPIED'; }
    catch { $('#funded-token-copy').textContent = 'COPY FAILED'; }
  });
  const detailKicker = $(':scope > .eyebrow', policy);
  if (detailKicker) detailKicker.textContent = 'Fee route details · published policy';
  const detailTitle = $(':scope > h2', policy);
  if (detailTitle) detailTitle.textContent = 'How the fee route works';
  window.dispatchEvent(new Event('funded:token-page-ready'));
}

export function mergePurposePages() {
  const groups = [
    { host: '#my-launches', child: '#community', after: ':scope > .section-heading', childAtEnd: true, label: 'Portfolio sections', links: [['my-launches', 'Portfolio'], ['community', 'Favorites']] },
    { host: '#analytics-detail', child: '#capital-flow', after: ':scope > .section-heading', childAtEnd: true, label: 'Analytics sections', links: [['analytics-detail', 'Activity'], ['capital-flow', 'Capital flow']] },
    { host: '#paid', child: '#buybacks', after: ':scope > .paid-reference-metrics', label: '$FUNDED sections', links: [['paid', 'Token overview'], ['buybacks', 'Buy & burn']] },
  ];
  for (const group of groups) {
    const host = $(group.host);
    const child = $(group.child);
    if (!host || !child || host.contains(child)) continue;
    const anchor = $(group.after, host);
    if (!anchor) continue;
    const nav = node('nav', 'purpose-page-nav');
    nav.setAttribute('aria-label', group.label);
    for (const [route, label] of group.links) {
      const link = node('a', '', label);
      link.href = `#${route}`;
      link.dataset.purposeRoute = route;
      nav.append(link);
    }
    anchor.after(nav);
    if (group.childAtEnd) host.append(child);
    else nav.after(child);
  }
}
