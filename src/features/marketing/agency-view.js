import {loadTokenArtwork} from '../shared/token-artwork.js';
import { MARKETING_AGENCY_POLICY as POLICY } from '../../../config/marketing-agency.js';
import { renderAgencyHistory } from './agency-history.js';
import {agencyTokenTable} from './agency-token-table.js';
import {buybackProgressTable} from './buyback-progress.js';
import { readLaunchAgencySelection } from './agency-selection.js';

const agentDescription = agent => agent.id === 'x-promotion'
  ? 'Up to one X post per 24 hours. Billed after the post is verified.'
  : `One-time token buyback and burn at a verified $${agent.marketCapUsd.toLocaleString('en-US')} market cap.`;

export function initMarketingAgency(document = globalThis.document) {
  const main = document?.querySelector('.main-content');
  if (!main || document.getElementById('marketing-agency')) return;
  const view = document.defaultView, page = document.createElement('section');
  let verifiedRates=null, publishingPaused=null,manualEmailReady=false,agencyGrossPercent=2,agencyReady=false,updateLaunchTeam=()=>{};
  page.id = 'marketing-agency'; page.className = 'agency-page section-block';
  page.setAttribute('aria-labelledby', 'agency-title');
  page.innerHTML = `<header class="section-heading"><div><p class="eyebrow">Launch promotion</p><h1 id="agency-title">Help your project reach more people.</h1><p>Explore promotion and funded milestone buybacks for your community.</p></div><button type="button" data-agency-refresh>Refresh</button></header>
    <div class="agency-agent-grid" data-agency-cards></div>
    <details class="agency-policy"><summary>Fee policy</summary><div class="agency-policy-body"><h2 id="agency-policy-title">New-launch agency allocation</h2>
      <p data-agency-policy-split>80% creator-directed · 8% Operations &amp; marketing · 1% referrals · 2% AI marketing &amp; coin buybacks · 4% Daily bonus · 5% $RICH buyback &amp; burn.</p>
      <p data-agency-policy-referrals>Both buyback agents are included in every new launch. Promotion packages also include X promotion. Included agents share the agency allocation equally. Actions require verified funding and ready executors. Existing coins keep their saved selections. Referral levels: ${POLICY.referralUnits.map((units,index)=>`L${index+1} ${units*100/POLICY.grossUnits}%`).join(' · ')} of gross collected creator fees.</p>
      <p>Agents 2 and 3 each buy and burn the launched coin once, using only their accumulated budget. Reaching a milestone is not a purchase or burn receipt. Later fees remain reserved after a one-time action.</p>
      <p>The separate $RICH buyback allocation keeps its own trigger and funds. Existing launches retain their signed fee policy.</p>
      <a href="#capital-flow">View the currently active fee policy →</a></div></details>
    <section aria-labelledby="agency-tokens-title"><h2 id="agency-tokens-title">Tokens &amp; agent budgets</h2><div data-agency-tokens>Checking registered tokens…</div></section>
    <section aria-labelledby="agency-budget-title"><h2 id="agency-budget-title">Agency funds &amp; activity</h2><dl class="agency-funds"><div><dt>Verified funding</dt><dd data-agency-funded>Unavailable</dd></div><div><dt>Verified spending</dt><dd data-agency-spent>Unavailable</dd></div></dl><p data-agency-history>No agency execution history has been verified.</p></section>
    <a class="text-button" href="#launch">Review launch promotions →</a>`;
  for (const agent of POLICY.agents) {
    const card = document.createElement('article'); card.className = 'agency-agent';
    const title = document.createElement('h2'); title.textContent = agent.name;
    const description = document.createElement('p'); description.textContent = agentDescription(agent);
    const state = document.createElement('span'); state.className = 'data-badge'; state.textContent = 'Not activated';
    card.append(title, description, state); page.querySelector('[data-agency-cards]').append(card);
  }
  main.insertBefore(page, main.querySelector(':scope > .site-footer'));
  const buybackProgress=document.createElement('section');buybackProgress.dataset.buybackProgress='';page.querySelector('[data-agency-tokens]').parentElement.after(buybackProgress);
  const loadLogos=()=>page.querySelectorAll('.agency-token-link[data-logo-mint]').forEach(link=>loadTokenArtwork(link.querySelector('.agency-token-logo'),link.dataset.logoMint));
  const oldHistory=page.querySelector('[data-agency-history]'),historyContainer=document.createElement('div');
  historyContainer.dataset.agencyHistory='';historyContainer.textContent=oldHistory.textContent;oldHistory.replaceWith(historyContainer);
  const nav = document.querySelector('.primary-nav'), anchor = nav?.querySelector('a[href="#capital-flow"]');
  if (nav && !nav.querySelector('a[href="#marketing-agency"]')) {
    const link = document.createElement('a'); link.href = '#marketing-agency'; link.className = 'nav-item';
    const icon = document.createElement('span'); icon.className = 'nav-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✦';
    link.append(icon, 'AI Marketing'); anchor ? anchor.after(link) : nav.append(link);
  }
  const promotion = document.querySelector('.creator-burn-section');
  if (promotion && !document.getElementById('launch-agency-options')) {
    const fieldset = document.createElement('fieldset'); fieldset.id = 'launch-agency-options'; fieldset.className = 'agency-options';
    const legend = document.createElement('legend'); legend.textContent = 'AI marketing team'; fieldset.append(legend);
    const help = document.createElement('p'); help.id = 'launch-agency-help'; help.textContent = 'New launches wait for verified fee vaults and executors. Agent execution is not yet available.'; help.setAttribute('role','status');
    const terms = document.createElement('p'); terms.id = 'launch-package-terms';
    const team = document.createElement('ul'); team.className = 'agency-included-list'; fieldset.append(team);
    for (const agent of POLICY.agents) {
      const row = document.createElement('li'), name = document.createElement('span'), badge = document.createElement('span');
      row.dataset.launchAgent = agent.id; name.dataset.launchAgentName = ''; name.textContent = agent.name;
      badge.className = 'agency-included-badge'; badge.textContent = 'Included'; row.append(name,badge); team.append(row);
    }
    const split = document.createElement('p'); split.dataset.agencySplit = ''; split.setAttribute('role', 'status');
    const update = () => {
      const selected=readLaunchAgencySelection({requiresBurn:['boost','pro','premier'].includes(promotion.dataset.selectedTier)});
      for(const row of team.children){const included=selected.includes(row.dataset.launchAgent);row.dataset.included=String(included);row.querySelector('.agency-included-badge').textContent=included?'Included':'Promotion only';}
      const postStatus = 'Launch promotion is posted manually by the admin after the launch is confirmed. Posting is not immediate.';
      for (const card of promotion.querySelectorAll('[data-burn-tier]')) {
        let note = card.querySelector('[data-post-availability]');
        if (!note) { note = document.createElement('small'); note.dataset.postAvailability = ''; card.append(note); }
        note.textContent = 'Admin posts your launch promotion manually.';
        note.title = postStatus;
        note.hidden = !note.textContent;
      }
      terms.textContent = [postStatus, selected.includes('x-promotion') ? 'Launch and migration drafts are emailed to admin for manual posting.' : ''].filter(Boolean).join(' ');
      const review = document.getElementById('launch-review-package');
      if (review) review.textContent = terms.textContent + ' ' + agencyGrossPercent + '% shared equally among ' + selected.length + ' included agents (' + (agencyGrossPercent / selected.length).toLocaleString(undefined,{maximumFractionDigits:4}) + '% each, rounded).';
      split.textContent=`${agencyGrossPercent}% of collected creator fees · shared equally across the ${selected.length} included agents (≈${(agencyGrossPercent/selected.length).toLocaleString(undefined,{maximumFractionDigits:4})}% each).`;
      help.textContent=agencyReady?'Actions wait for verified funding and their milestones.':'Agent execution is not yet available.';
      for(const row of document.querySelectorAll('[data-fixed-fee-category="agency"]')){row.dataset.agencyState=agencyReady?'ready':'paused';row.title=agencyReady?'':'Agent execution is not yet available. This share stays reserved for the agents of this coin.';}
      if(publishingPaused&&!manualEmailReady&&selected.includes('x-promotion'))help.textContent+=' X promotion is paused; its budget stays reserved.';
    };
    updateLaunchTeam=update;view.addEventListener('funded:launch-promotion',update);
    fieldset.addEventListener('change', update); update(); promotion.append(fieldset);
  }
  function teamReadiness(active){agencyReady=active;updateLaunchTeam();}
  const readiness=event=>teamReadiness(event.detail?.active===true);
  view.addEventListener('funded:agency-readiness',readiness);
  const sol=value=>{if(!/^(0|[1-9]\d{0,19})$/.test(String(value)))return'Unavailable';const n=BigInt(value),fraction=String(n%1000000000n).padStart(9,'0').replace(/0+$/,'');return`${n/1000000000n}${fraction?'.'+fraction:''} SOL`;};
  let serial = 0, request;
  async function refresh() {
    const id = ++serial; request?.abort(); const controller = new AbortController(); request = controller;
    const timeout = view.setTimeout(() => controller.abort(), 10_000);
    page.querySelectorAll('.agency-agent .data-badge').forEach(node=>{node.textContent='Checking availability';});
    page.querySelector('[data-agency-funded]').textContent = 'Unavailable';
    page.querySelector('[data-agency-spent]').textContent = 'Unavailable';
    try {
      const response = await view.fetch('/api/marketing-agency', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json(); if (id !== serial) return;
      manualEmailReady=data.agents?.some(row=>row.id==='x-promotion'&&row.enabled===true&&row.status==='manual-ready'&&row.deliveryMode==='admin-email')===true;
      buybackProgress.textContent='Checking buyback funding…';
      void view.fetch('/api/marketing-agency/progress',{cache:'no-store',signal:AbortSignal.timeout(10000)}).then(r=>r.ok?r.json():null).catch(()=>null).then(progress=>{if(id===serial&&progress?.scope==='display-only'){data.progress=progress.rows;page.querySelector('[data-agency-tokens]').innerHTML=agencyTokenTable(data);loadLogos();}});
      void view.fetch('/api/buyback/status',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(r=>r.ok?r.json():null).catch(()=>null).then(buyback=>{if(id===serial){buybackProgress.innerHTML=buybackProgressTable(buyback,data.launches||[]);loadLogos();}});
      page.querySelectorAll('.agency-agent').forEach((card,index)=>{
        let reason=card.querySelector('[data-agent-reason]');if(!reason){reason=document.createElement('small');reason.dataset.agentReason='';card.append(reason);}
        const row=data.agents?.find(row=>row.id===POLICY.agents[index].id);reason.textContent=row?.reason||'';
        if(index===0&&manualEmailReady)card.querySelector('p').textContent='Launch and migration post drafts sent to admin email, with a Post to X button.';
      });
      if(data.status==='deployment-verified'&&data.active===true&&typeof data.executionEnabled==='boolean'){
        const proof=data.verification;
        if(data.policy?.version!==POLICY.version||proof?.scope!=='reviewed-devnet-program-and-fresh-worker'
          ||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proof.programId)||!/^[a-f0-9]{64}$/.test(proof.approvedHash)
          ||!/^[a-f0-9]{40}$/.test(proof.build)||!(/^[1-9]\d{0,19}$/).test(String(proof.configRevision)))throw new Error('Unverified agency deployment');
        if(!Array.isArray(data.agents)||data.agents.length!==POLICY.agents.length||POLICY.agents.some(agent=>
          data.agents.filter(row=>row.id===agent.id&&typeof row.enabled==='boolean').length!==1)
          ||(data.publishingPaused&&data.agents.some(row=>row.id==='x-promotion'&&(row.enabled&&!(row.deliveryMode==='admin-email'&&row.status==='manual-ready')||!['paused','manual-ready'].includes(row.status)))))
          throw new Error('Unverified per-agent readiness');
        const rates=data.requiredGrossPercent;
        if(rates&&Object.values(rates).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)){
          verifiedRates=rates; agencyGrossPercent=rates.agency;
          page.querySelector('[data-agency-policy-split]').textContent=`${rates.creator}% creator-directed · ${rates.operations}% Operations & marketing · ${rates.referrals}% referrals · ${rates.agency}% AI marketing & coin buybacks · ${rates.dailyBonus}% Daily bonus · ${rates.fundedBuyback}% $RICH buyback & burn.`;
          page.querySelector('[data-agency-policy-referrals]').textContent=`Both buyback agents are included in every new launch. Promotion packages also include X promotion. Included agents share the agency allocation equally. Existing coins keep their saved selections. Referral levels: ${data.referralGrossPercents.map((n,i)=>`L${i+1} ${n}%`).join(' · ')} of gross collected creator fees.`;
        }
        for(const[ i,card]of [...page.querySelectorAll('.agency-agent')].entries()){
          const agent=data.policy.agents[i];card.querySelector('h2').textContent=agent.name;if(!(agent.id==='x-promotion'&&manualEmailReady))card.querySelector('p').textContent=agent.description;
          const label=document.querySelector(`[data-launch-agent="${agent.id}"] [data-launch-agent-name]`);
          if(label)label.textContent=agent.name;
        }
        publishingPaused=data.publishingPaused===true;teamReadiness(data.executionEnabled);page.querySelector('#agency-policy-title').textContent='Published new-launch fee policy';
        page.querySelectorAll('.agency-agent .data-badge').forEach((node,index)=>{
          const row=data.agents?.find(row=>row.id===POLICY.agents[index].id);
          // Keep each agent status and its readiness reason on its card.
          node.textContent=row?.id==='x-promotion'&&manualEmailReady?'Email drafts enabled':row?.id==='x-promotion'&&data.publishingPaused?'Manual posting':row?.enabled===true?'Available':'Paused';node.title=row?.deliveryMode==='admin-email'?row.reason:row?.enabled===true?'Execution requires proof':row?.reason||'Readiness unverified';
        });
        page.querySelector('[data-agency-funded]').textContent=data.funding?.status==='worker-verified-snapshots'?sol(data.funding.collectedLamports):'Unavailable';
        page.querySelector('[data-agency-spent]').textContent=data.funding?.status==='worker-verified-snapshots'?sol(data.funding.spentLamports):'Unavailable';
        renderAgencyHistory(page.querySelector('[data-agency-history]'),data,{currentVerified:true});
        page.querySelector('[data-agency-tokens]').innerHTML=agencyTokenTable(data);loadLogos();
        return;
      }
      if (data.status !== 'activation-blocked' || data.active !== false || data.executionEnabled !== false
        || data.policy?.version !== POLICY.version) throw new Error('Unverified agency capability');
      verifiedRates=null; publishingPaused=data.publishingPaused===true;teamReadiness(false);page.querySelector('#agency-policy-title').textContent='New-launch agency allocation';
      if(data.feePolicy?.status==='published')page.querySelector('#agency-policy-title').textContent='Published new-launch fee policy';
      page.querySelectorAll('.agency-agent .data-badge').forEach((node,index)=>{
        const row=data.agents?.find(row=>row.id===POLICY.agents[index].id);
        node.textContent=row?.id==='x-promotion'&&manualEmailReady?'Email drafts enabled':row?.id==='x-promotion'&&data.publishingPaused?'Manual posting':row?.reason?'Paused':'Unavailable';node.title=row?.reason||'Readiness unavailable';
      });
      page.querySelector('[data-agency-funded]').textContent = data.funding?.status==='worker-verified-snapshots'?sol(data.funding.collectedLamports):'Unavailable';
      page.querySelector('[data-agency-spent]').textContent = data.funding?.status==='worker-verified-snapshots'?sol(data.funding.spentLamports):'Unavailable';
      renderAgencyHistory(page.querySelector('[data-agency-history]'),data);
      page.querySelector('[data-agency-tokens]').innerHTML=agencyTokenTable(data);loadLogos();
    } catch {
      if (id === serial){verifiedRates=null; publishingPaused=null; manualEmailReady=false; teamReadiness(false);
        page.querySelectorAll('.agency-agent .data-badge').forEach(node=>{node.textContent='Unavailable';});renderAgencyHistory(page.querySelector('[data-agency-history]'),null);page.querySelector('[data-agency-tokens]').textContent='Token budgets are unavailable. Refresh to retry.';}
    } finally { view.clearTimeout(timeout); }
  }
  const active = () => ['marketing-agency','launch'].includes((view.location.hash || view.location.pathname).replace(/^([#/]+)/,'')) && !document.hidden;
  let activeRoute = '';
  const route = () => {
    const next = active() ? (view.location.hash || view.location.pathname) : '';
    if (next === activeRoute) return;
    activeRoute = next;
    if (next) void refresh();
  };
  page.querySelector('[data-agency-refresh]').addEventListener('click', () => { void refresh(); });
  view.addEventListener('funded:route-change', route); view.addEventListener('hashchange', route); document.addEventListener('visibilitychange', route); route();
  return () => { ++serial; request?.abort(); view.removeEventListener('funded:route-change', route); view.removeEventListener('hashchange', route);view.removeEventListener('funded:agency-readiness',readiness);view.removeEventListener('funded:launch-promotion',updateLaunchTeam); document.removeEventListener('visibilitychange', route); };
}
