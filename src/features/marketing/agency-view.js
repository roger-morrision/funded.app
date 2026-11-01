import { MARKETING_AGENCY_POLICY as POLICY } from '../../../config/marketing-agency.js';
import { renderAgencyHistory } from './agency-history.js';
import { readLaunchAgencySelection } from './agency-selection.js';

const agentDescription = agent => agent.id === 'x-promotion'
  ? 'Up to one X post per 24 hours. Billed after the post is verified.'
  : `One-time token buyback and burn at a verified $${agent.marketCapUsd.toLocaleString('en-US')} market cap.`;

export function initMarketingAgency(document = globalThis.document) {
  const main = document?.querySelector('.main-content');
  if (!main || document.getElementById('marketing-agency')) return;
  const view = document.defaultView, page = document.createElement('section');
  let publishingPaused=false,agencyGrossPercent=2,agencyReady=false,updateLaunchTeam=()=>{};
  page.id = 'marketing-agency'; page.className = 'agency-page section-block';
  page.setAttribute('aria-labelledby', 'agency-title');
  page.innerHTML = `<header class="section-heading"><div><p class="eyebrow">Launch promotion</p><h1 id="agency-title">Marketing agents</h1><p>Buyback agents are included. Promotion packages add X promotion.</p></div><button type="button" data-agency-refresh>Refresh</button></header>
    <p class="agency-status" data-agency-status role="status">Checking agency activation…</p>
    <div class="agency-agent-grid" data-agency-cards></div>
    <details class="agency-policy"><summary>Fee policy</summary><div class="agency-policy-body"><h2 id="agency-policy-title">New-launch agency allocation</h2>
      <p data-agency-policy-split>80% creator-directed · 8% Operations &amp; marketing · 1% referrals · 2% AI marketing &amp; coin buybacks · 4% Daily bonus · 5% $FUNDED buyback &amp; burn.</p>
      <p data-agency-policy-referrals>Both buyback agents are included in every new launch. Promotion packages also include X promotion. Included agents share the agency allocation equally. Actions require verified funding and ready executors. Existing coins keep their saved selections. Referral levels: ${POLICY.referralUnits.map((units,index)=>`L${index+1} ${units*100/POLICY.grossUnits}%`).join(' · ')} of gross collected creator fees.</p>
      <p>Agents 2 and 3 each buy and burn the launched coin once, using only their accumulated budget. Reaching a milestone is not a purchase or burn receipt. Later fees remain reserved after a one-time action.</p>
      <p>The separate $FUNDED buyback allocation keeps its own trigger and funds. Existing launches retain their signed fee policy.</p>
      <a href="#capital-flow">View the currently active fee policy →</a></div></details>
    <section aria-labelledby="agency-budget-title"><h2 id="agency-budget-title">Agency funds &amp; activity</h2><dl class="agency-funds"><div><dt>Verified funding</dt><dd data-agency-funded>Unavailable</dd></div><div><dt>Verified spending</dt><dd data-agency-spent>Unavailable</dd></div></dl><p data-agency-history>No agency execution history has been verified.</p></section>
    <a class="text-button" href="#launch">Review launch promotions →</a>`;
  for (const agent of POLICY.agents) {
    const card = document.createElement('article'); card.className = 'agency-agent';
    const title = document.createElement('h2'); title.textContent = agent.name;
    const description = document.createElement('p'); description.textContent = agentDescription(agent);
    const state = document.createElement('span'); state.className = 'data-badge'; state.textContent = 'Not activated';
    card.append(title, description, state); page.querySelector('[data-agency-cards]').append(card);
  }
  main.append(page);
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
    const included = document.createElement('p'); included.className = 'agency-included-intro'; included.textContent = 'Buyback agents are included. Pro/Premier adds X promotion.';
    const help = document.createElement('p'); help.id = 'launch-agency-help'; help.textContent = 'New launches wait for verified fee vaults and executors. Agent execution is not yet available.'; help.setAttribute('role','status');
    fieldset.append(included); fieldset.setAttribute('aria-describedby', help.id);
    const team = document.createElement('ul'); team.className = 'agency-included-list'; fieldset.append(team);
    for (const agent of POLICY.agents) {
      const row = document.createElement('li'), name = document.createElement('span'), badge = document.createElement('span');
      row.dataset.launchAgent = agent.id; name.dataset.launchAgentName = ''; name.textContent = agent.name;
      badge.className = 'agency-included-badge'; badge.textContent = 'Included'; row.append(name,badge); team.append(row);
    }
    const split = document.createElement('p'); split.dataset.agencySplit = ''; split.setAttribute('role', 'status'); fieldset.append(split);
    const update = () => {
      const selected=readLaunchAgencySelection({requiresBurn:['boost','pro','premier'].includes(promotion.dataset.selectedTier)});
      for(const row of team.children){const included=selected.includes(row.dataset.launchAgent);row.dataset.included=String(included);row.querySelector('.agency-included-badge').textContent=included?'Included':'Promotion only';}
      split.textContent=`${agencyGrossPercent}% of collected creator fees · shared equally across the ${selected.length} included agents.`;
      help.textContent=agencyReady?'Actions wait for verified funding and their milestones.':'Agent execution is not yet available.';
      if(publishingPaused&&selected.includes('x-promotion'))help.textContent+=' X promotion is paused; its budget stays reserved.';
    };
    updateLaunchTeam=update;view.addEventListener('funded:launch-promotion',update);
    fieldset.append(help); fieldset.addEventListener('change', update); update(); promotion.append(fieldset);
  }
  function teamReadiness(active){agencyReady=active;updateLaunchTeam();}
  const readiness=event=>teamReadiness(event.detail?.active===true);
  view.addEventListener('funded:agency-readiness',readiness);
  const sol=value=>{if(!/^(0|[1-9]\d{0,19})$/.test(String(value)))return'Unavailable';const n=BigInt(value),fraction=String(n%1000000000n).padStart(9,'0').replace(/0+$/,'');return`${n/1000000000n}${fraction?'.'+fraction:''} SOL`;};
  let serial = 0, request;
  async function refresh() {
    const id = ++serial; request?.abort(); request = new AbortController();
    const timeout = view.setTimeout(() => request?.abort(), 10_000);
    page.querySelector('[data-agency-status]').textContent = 'Checking agency activation…';
    page.querySelectorAll('.agency-agent .data-badge').forEach(node=>{node.textContent='Checking availability';});
    page.querySelector('[data-agency-funded]').textContent = 'Unavailable';
    page.querySelector('[data-agency-spent]').textContent = 'Unavailable';
    try {
      const response = await view.fetch('/api/marketing-agency', { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json(); if (id !== serial) return;
      if(data.status==='deployment-verified'&&data.active===true&&data.executionEnabled===true){
        const proof=data.verification;
        if(data.policy?.version!==POLICY.version||proof?.scope!=='reviewed-devnet-program-and-fresh-worker'
          ||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proof.programId)||!/^[a-f0-9]{64}$/.test(proof.approvedHash)
          ||!/^[a-f0-9]{40}$/.test(proof.build)||!(/^[1-9]\d{0,19}$/).test(String(proof.configRevision)))throw new Error('Unverified agency deployment');
        if(!Array.isArray(data.agents)||data.agents.length!==POLICY.agents.length||POLICY.agents.some(agent=>
          data.agents.filter(row=>row.id===agent.id&&typeof row.enabled==='boolean').length!==1)
          ||(data.publishingPaused&&data.agents.some(row=>row.id==='x-promotion'&&(row.enabled||row.status!=='paused'))))
          throw new Error('Unverified per-agent readiness');
        const rates=data.requiredGrossPercent;
        if(rates&&Object.values(rates).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)){
          agencyGrossPercent=rates.agency;
          page.querySelector('[data-agency-policy-split]').textContent=`${rates.creator}% creator-directed · ${rates.operations}% Operations & marketing · ${rates.referrals}% referrals · ${rates.agency}% AI marketing & coin buybacks · ${rates.dailyBonus}% Daily bonus · ${rates.fundedBuyback}% $FUNDED buyback & burn.`;
          page.querySelector('[data-agency-policy-referrals]').textContent=`Both buyback agents are included in every new launch. Promotion packages also include X promotion. Included agents share the agency allocation equally. Existing coins keep their saved selections. Referral levels: ${data.referralGrossPercents.map((n,i)=>`L${i+1} ${n}%`).join(' · ')} of gross collected creator fees.`;
        }
        for(const[ i,card]of [...page.querySelectorAll('.agency-agent')].entries()){
          const agent=data.policy.agents[i];card.querySelector('h2').textContent=agent.name;card.querySelector('p').textContent=agent.description;
          const label=document.querySelector(`[data-launch-agent="${agent.id}"] [data-launch-agent-name]`);
          if(label)label.textContent=agent.name;
        }
        publishingPaused=data.publishingPaused===true;teamReadiness(true);page.querySelector('#agency-policy-title').textContent='Published new-launch fee policy';
        page.querySelector('[data-agency-status]').textContent=data.publishingPaused
          ?'Buyback agents are available on Devnet. X promotion stays paused until the account is reinstated; its budget remains reserved. Buybacks wait for verified funding and their saved market-cap milestones.'
          :'Agency execution enabled on Devnet. Actions wait for protected funding, cadence and verified milestones; receipts below establish completed actions.';
        page.querySelectorAll('.agency-agent .data-badge').forEach((node,index)=>{
          const row=data.agents?.find(row=>row.id===POLICY.agents[index].id);
          node.textContent=row?.status==='paused'?'Paused · X account suspended':row?.enabled===false?'Not activated':'Available · execution requires proof';
        });
        page.querySelector('[data-agency-funded]').textContent=data.funding?.status==='worker-verified-snapshots'?sol(data.funding.collectedLamports):'Unavailable';
        page.querySelector('[data-agency-spent]').textContent=data.funding?.status==='worker-verified-snapshots'?sol(data.funding.spentLamports):'Unavailable';
        renderAgencyHistory(page.querySelector('[data-agency-history]'),data,{currentVerified:true});
        return;
      }
      if (data.status !== 'activation-blocked' || data.active !== false || data.executionEnabled !== false
        || data.policy?.version !== POLICY.version) throw new Error('Unverified agency capability');
      publishingPaused=data.publishingPaused===true;teamReadiness(false);page.querySelector('#agency-policy-title').textContent='New-launch agency allocation';
      if(data.feePolicy?.status==='published')page.querySelector('#agency-policy-title').textContent='Published new-launch fee policy';
      page.querySelectorAll('.agency-agent .data-badge').forEach((node,index)=>{
        node.textContent=data.agents?.find(row=>row.id===POLICY.agents[index].id)?.status==='paused'?'Paused · X account suspended':'Readiness unavailable';
      });
      page.querySelector('[data-agency-status]').textContent = `${data.feePolicy?.status==='published'?'The 1% referral / 2% agency policy is published. ':''}Current agency readiness is unavailable. Agency execution is unavailable. New agency launches remain disabled until deployment and worker verification passes.${data.publishingPaused?' X promotion is paused pending account reinstatement.':''} Earlier receipts below do not establish current readiness. See Capital flow for the published fee policy.`;
      page.querySelector('[data-agency-funded]').textContent = 'Unavailable';
      page.querySelector('[data-agency-spent]').textContent = 'Unavailable';
      renderAgencyHistory(page.querySelector('[data-agency-history]'),data);
    } catch {
      if (id === serial){teamReadiness(false);page.querySelector('[data-agency-status]').textContent = 'Agency status unavailable. No agency funding or execution is confirmed. Refresh to try again.';
        page.querySelectorAll('.agency-agent .data-badge').forEach(node=>{node.textContent='Unavailable';});renderAgencyHistory(page.querySelector('[data-agency-history]'),null);}
    } finally { view.clearTimeout(timeout); }
  }
  const active = () => ['#marketing-agency','#launch'].includes(view.location.hash) && !document.hidden;
  const route = () => { if (active()) void refresh(); };
  page.querySelector('[data-agency-refresh]').addEventListener('click', () => { void refresh(); });
  view.addEventListener('hashchange', route); document.addEventListener('visibilitychange', route); route();
  return () => { ++serial; request?.abort(); view.removeEventListener('hashchange', route);view.removeEventListener('funded:agency-readiness',readiness);view.removeEventListener('funded:launch-promotion',updateLaunchTeam); document.removeEventListener('visibilitychange', route); };
}
