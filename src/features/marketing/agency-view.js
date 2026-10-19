import { MARKETING_AGENCY_POLICY as POLICY } from '../../../config/marketing-agency.js';
import { readLaunchAgencySelection } from './agency-selection.js';

export function initMarketingAgency(document = globalThis.document) {
  const main = document?.querySelector('.main-content');
  if (!main || document.getElementById('marketing-agency')) return;
  const view = document.defaultView, page = document.createElement('section');
  page.id = 'marketing-agency'; page.className = 'agency-page section-block';
  page.setAttribute('aria-labelledby', 'agency-title');
  page.innerHTML = `<header class="section-heading"><div><p class="eyebrow">AI marketing agency teams</p><h1 id="agency-title">A team for every launch</h1><p>Select promotion agents when preparing a coin. Each agent uses its own share of the agency budget.</p></div><button type="button" data-agency-refresh>Refresh status</button></header>
    <p class="agency-status" data-agency-status role="status">Checking agency activation…</p>
    <div class="agency-agent-grid" data-agency-cards></div>
    <section class="agency-policy" aria-labelledby="agency-policy-title"><h2 id="agency-policy-title">New-launch fee policy · awaiting activation</h2>
      <p>80% creator-directed · 8% Operations &amp; marketing · 1% referrals · 2% AI agency · 4% Daily bonus · 5% $FUNDED buyback.</p>
      <p>The agency allocation applies to every new launch after activation and is divided equally among selected agents. With no selection, it remains reserved. Referral levels: L1 0.6667% · L2 0.2% · L3 0.1333% of gross collected creator fees.</p>
      <p>Agents 2 and 3 each buy and burn the launched coin once, using only their accumulated budget. Reaching a milestone is not a purchase or burn receipt. Later fees remain reserved after a one-time action.</p>
      <p>The separate 5% $FUNDED buyback allocation keeps its own trigger and funds. Existing launches retain their signed fee policy.</p>
      <a href="#capital-flow">View the currently active fee policy →</a></section>
    <section aria-labelledby="agency-budget-title"><h2 id="agency-budget-title">Agency funds &amp; activity</h2><dl class="agency-funds"><div><dt>Verified agency funding</dt><dd data-agency-funded>Unavailable</dd></div><div><dt>Verified agency spending</dt><dd data-agency-spent>Unavailable</dd></div></dl><p data-agency-history>No agency execution history has been verified.</p></section>
    <a class="text-button" href="#launch">Review launch promotions →</a>`;
  for (const agent of POLICY.agents) {
    const card = document.createElement('article'); card.className = 'agency-agent';
    const title = document.createElement('h2'); title.textContent = agent.name;
    const description = document.createElement('p'); description.textContent = agent.description;
    const state = document.createElement('span'); state.className = 'data-badge'; state.textContent = 'Not activated';
    card.append(title, description, state); page.querySelector('[data-agency-cards]').append(card);
  }
  main.append(page);
  const nav = document.querySelector('.primary-nav'), anchor = nav?.querySelector('a[href="#capital-flow"]');
  if (nav && !nav.querySelector('a[href="#marketing-agency"]')) {
    const link = document.createElement('a'); link.href = '#marketing-agency'; link.className = 'nav-item';
    const icon = document.createElement('span'); icon.className = 'nav-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✦';
    link.append(icon, 'AI Marketing'); anchor ? anchor.after(link) : nav.append(link);
  }
  const promotion = document.querySelector('.creator-burn-section');
  if (promotion && !document.getElementById('launch-agency-options')) {
    const fieldset = document.createElement('fieldset'); fieldset.id = 'launch-agency-options'; fieldset.className = 'agency-options';
    const legend = document.createElement('legend'); legend.textContent = 'AI marketing team · preview'; fieldset.append(legend);
    const help = document.createElement('p'); help.id = 'launch-agency-help'; help.textContent = 'Agency activation is pending. Preview the team here; agency-enabled launch submission is unavailable until its fee vault and executors are verified.';
    fieldset.append(help); fieldset.setAttribute('aria-describedby', help.id);
    for (const agent of POLICY.agents) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = agent.id; input.dataset.launchAgency = ''; input.setAttribute('aria-describedby', help.id);
      label.append(input, agent.name); fieldset.append(label);
    }
    const split = document.createElement('p'); split.dataset.agencySplit = ''; split.setAttribute('role', 'status'); fieldset.append(split);
    const update = () => {
      const ids = readLaunchAgencySelection(document);
      split.textContent = ids.length ? `2% of gross collected fees, split equally across ${ids.length} selected agent${ids.length === 1 ? '' : 's'}. Activation pending; no funds move.` : 'No team selected. The proposed 2% agency share remains in reserve after activation.';
    };
    fieldset.addEventListener('change', update); update(); promotion.append(fieldset);
  }
  let serial = 0, request;
  async function refresh() {
    const id = ++serial; request?.abort(); request = new AbortController();
    const timeout = view.setTimeout(() => request?.abort(), 10_000);
    page.querySelector('[data-agency-status]').textContent = 'Checking agency activation…';
    page.querySelector('[data-agency-funded]').textContent = 'Unavailable';
    page.querySelector('[data-agency-spent]').textContent = 'Unavailable';
    try {
      const response = await view.fetch('/api/marketing-agency', { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json(); if (id !== serial) return;
      // This candidate cannot render an affirmative readiness assertion: its
      // current contract and executors have no agency support to verify.
      if (data.status !== 'activation-blocked' || data.active !== false || data.executionEnabled !== false
        || data.policy?.version !== POLICY.version) throw new Error('Unverified agency capability');
      page.querySelector('[data-agency-status]').textContent = 'Not activated. The dedicated V3 agency budget and execution verification are still required. The new 1% referral / 2% agency split is not active yet.';
      page.querySelector('[data-agency-funded]').textContent = 'Unavailable';
      page.querySelector('[data-agency-spent]').textContent = 'Unavailable';
    } catch {
      if (id === serial) page.querySelector('[data-agency-status]').textContent = 'Agency status unavailable. No agency funding or execution is confirmed. Refresh to try again.';
    } finally { view.clearTimeout(timeout); }
  }
  const active = () => view.location.hash === '#marketing-agency' && !document.hidden;
  const route = () => { if (active()) void refresh(); };
  page.querySelector('[data-agency-refresh]').addEventListener('click', () => { void refresh(); });
  view.addEventListener('hashchange', route); document.addEventListener('visibilitychange', route); route();
  return () => { ++serial; request?.abort(); view.removeEventListener('hashchange', route); document.removeEventListener('visibilitychange', route); };
}
