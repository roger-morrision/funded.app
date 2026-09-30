// Workspace composition owns layout and navigation. Financial state remains in its source modules.
import { EXPLORE_CLUSTER } from './app-config.js';
import './workspace-ui.css';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const text = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
};
const iconPaths = {
  explore: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  launch: '<path d="M12 4v16M4 12h16"/>',
  portfolio: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 13h18M10 13v3h4v-3"/>',
  rewards: '<path d="M4 10h16v11H4zM2 6h20v4H2zM12 6v15"/><path d="M12 6C3 6 6-2 12 6c6-8 9 0 0 0"/>',
  analytics: '<path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4"/>',
  burn: '<path d="M12 2c1 6 7 7 7 13a7 7 0 0 1-14 0c0-3 2-6 4-8 0 4 2 4 3-5Z"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.explore}</svg>`;
}

// Moves existing nodes, preserving listeners, IDs, and live data updates.
function disclose(target, label, { open = false, id } = {}) {
  if (!target || target.parentElement?.classList.contains('ui-disclosure')) return null;
  const details = node('details', 'ui-disclosure');
  if (id) details.id = id;
  details.open = open;
  if (target.parentElement?.classList.contains('main-content')) {
    details.dataset.workspaceRoute = target.matches('.referral-toolkit,.referral-progress-panel') ? 'referrals' : 'overview';
  }
  const summary = node('summary', '', label);
  target.before(details);
  details.append(summary, target);
  return details;
}

function tabs(root, entries, name) {
  const bar = node('div', 'ui-tabs');
  bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', name);
  const select = (key, focus = false) => {
    entries.forEach(entry => {
      const active = entry.key === key;
      entry.panel.hidden = !active;
      entry.button.setAttribute('aria-selected', String(active));
      entry.button.tabIndex = active ? 0 : -1;
      if (active && focus) entry.button.focus();
    });
    root.dataset.activeView = key;
  };
  entries.forEach(entry => {
    entry.panel.id ||= `${root.id}-${entry.key}`;
    entry.panel.classList.add('ui-tab-panel');
    entry.panel.setAttribute('role', 'tabpanel');
    entry.panel.tabIndex = 0;
    const button = node('button', '', entry.label);
    button.type = 'button'; button.id = `${entry.panel.id}-tab`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', entry.panel.id);
    entry.panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => select(entry.key));
    entry.button = button; bar.append(button);
  });
  bar.addEventListener('keydown', event => {
    const index = entries.findIndex(entry => entry.button === document.activeElement);
    if (index < 0) return;
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + offset + entries.length) % entries.length;
    if (offset || event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(entries[next].key, true); }
  });
  root.prepend(bar); select(entries[0].key);
  return select;
}

function navigation() {
  $$('[data-icon]').forEach(item => item.innerHTML = icon(item.dataset.icon));
  const mobile = node('nav', 'mobile-workspace-nav'); mobile.setAttribute('aria-label', 'Mobile workspace');
  for (const [href, label, glyph] of [['explore','Explore','explore'],['launch','Launch','launch'],['my-launches','Portfolio','portfolio'],['payments','Rewards','rewards']]) {
    const link = node('a', '', ''); link.href = `#${href}`;
    link.innerHTML = icon(glyph); link.append(node('span', '', label)); mobile.append(link);
  }
  document.body.append(mobile);
  const network = node('span', 'workspace-network', EXPLORE_CLUSTER === 'mainnet-beta' ? 'Mainnet · read only' : 'Devnet');
  network.title = 'Network for the current workspace'; $('.top-actions')?.prepend(network);
  const sidebar = $('#sidebar');
  sidebar?.addEventListener('click', event => {
    if (event.target.closest('a')) $('#close-menu')?.click();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { const more = $('.nav-more'); if (more?.open) { more.open = false; $('summary', more).focus(); } }
  });
  const preference = node('label', 'workspace-preference', 'Start page');
  const select = node('select'); select.setAttribute('aria-label', 'Preferred start page');
  select.innerHTML = '<option value="overview">Home</option><option value="explore">Explore</option>';
  try { select.value = localStorage.getItem('funded.start-page') || 'overview'; } catch {}
  select.addEventListener('change', () => { try { localStorage.setItem('funded.start-page', select.value); } catch {} });
  preference.append(select); $('#profile')?.append(preference);
  if (!location.hash && location.pathname === '/' && select.value === 'explore') location.hash = '#explore';
}

function home() {
  text('[data-home-launch-tab="trending"]', 'Market cap');
  const hero = $('.hero-section');
  const board = $('.home-launch-board');
  if (hero && board) hero.after(board);
  disclose($('.hero-stakeholders'), 'How participants benefit');
  disclose($('.home-kpi-dashboard'), 'Protocol metrics and data coverage');
  const quick = node('nav', 'workspace-shortcuts'); quick.setAttribute('aria-label', 'Get started');
  quick.dataset.workspaceRoute = 'overview';
  quick.innerHTML = '<a href="#launch"><strong>Launch a token</strong><span>Identity, economics, final review</span></a><a href="#payments"><strong>Check rewards</strong><span>Eligibility, claims, and receipts</span></a><a href="#docs"><strong>Understand the fees</strong><span>See where every allocation goes</span></a>';
  board?.after(quick);
  disclose($('.home-referral-guide'), 'How referral rewards work');
}

function explore() {
  const root = $('#explore');
  const leaders = $('.explore-benefit-leaders', root);
  const grid = $('#asset-grid') || $('.asset-grid', root);
  if (leaders && grid) { grid.after(leaders); disclose(leaders, 'Compare reward policies and market leaders'); }
  const sort = $('#explore-sort'); sort?.classList.remove('sr-only');
  if (sort) { const label = node('label', 'workspace-sort', 'Sort'); sort.before(label); label.append(sort); }
  const filterButton = $('#explore-filter-toggle');
  filterButton?.append(node('span', '', 'Filters'));
  const count = node('p', 'workspace-filter-summary'); count.id = 'workspace-filter-summary'; count.setAttribute('role','status');
  $('.explore-control-bar')?.after(count);
  const stage = $('.explore-stage-filter');
  if (stage) { text('[data-explore-stage="near"]', 'Graduating'); $('.explore-control-bar')?.before(stage); }
  const watch = node('a', 'workspace-watch-link', 'Watchlist'); watch.href = '#community'; $('.explore-tabs')?.append(watch);
  const keys = ['explore-search','explore-sort','explore-promotion-filter','explore-reward-filter','explore-risk-filter','explore-max-age-hours','explore-authority-filter','explore-min-volume-sol','explore-min-cap-sol','explore-min-trades','explore-min-traders'];
  let restoring = false;
  const capture = () => Object.fromEntries(keys.map(id => [id, $('#'+id)?.value || '']));
  const summarize = () => {
    const active = keys.slice(2).filter(id => { const value = $('#'+id)?.value; return value && value !== 'all'; });
    count.replaceChildren();
    if (!active.length && !$('#explore-search')?.value) return;
    count.append(node('span', '', `${active.length} filter${active.length === 1 ? '' : 's'}${$('#explore-search')?.value ? ' · search active' : ''}`));
    const clear = node('button', 'text-button', 'Clear all'); clear.type = 'button';
    clear.addEventListener('click', () => { $('#explore-clear-filters')?.click(); const search = $('#explore-search'); if(search){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));} });
    count.append(clear);
  };
  const save = () => {
    summarize(); if (restoring) return;
    try { sessionStorage.setItem('funded.explore-view', JSON.stringify(capture())); } catch {}
  };
  const restore = () => {
    restoring = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem('funded.explore-view') || '{}');
      for (const id of keys) { const input = $('#'+id); if(input && typeof saved[id] === 'string' && saved[id].length < 200){input.value=saved[id];input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true}));} }
    } catch {} finally { restoring = false; summarize(); }
  };
  root?.addEventListener('input', save); root?.addEventListener('change', save);
  root?.addEventListener('funded:explore-filters-cleared', save);
  $('#explore-clear-filters')?.addEventListener('click', save);
  restore();
}

function launch() {
  $('#wizard-hint')?.setAttribute('tabindex','-1');
  const path=$('.launch-profile-grid');
  const pathHeading=$('.launch-profile-heading');
  if(path){const options=node('div');path.before(options);if(pathHeading)options.append(pathHeading);options.append(path);disclose(options,'Optional launch presets');}
  const support=$('#support-target')?.closest('.support-launch-intent');
  const settings=$('[data-launch-step="2"]');
  if(support&&settings)settings.append(support);
  $$('[data-launch-step-target]').forEach(button=>button.setAttribute('aria-label',`Step ${button.dataset.launchStepTarget}: ${['Token details','Launch settings','Review'][Number(button.dataset.launchStepTarget)-1]}`));
  disclose($('.enhanced-token-page'), 'Optional story and roadmap');
  disclose($('.creator-burn-section'), 'Optional promotion tier · burns $FUNDED');
  text('#creator-burn-title', 'Promotion tier');
  text('#creator-burn-title + span', 'Burn receipt required');
  const summary = $('#launch-review-summary');
  const page = $('#launch-dialog');
  // Drafts contain only explicitly selected public metadata, never wallet state or approvals.
  const draftFields = ['token-name','token-symbol'];
  const draftTools = node('div','launch-draft-tools');
  const draftStatus = node('span','field-help','Save token name and ticker on this device.');
  draftStatus.setAttribute('role','status');
  for (const [label, action] of [['Save draft','save'],['Restore draft','restore'],['Delete saved draft','delete']]) {
    const button = node('button','text-button',label);button.type='button';button.dataset.draftAction=action;
    button.addEventListener('click',()=>{
      try {
        const key='funded.public-launch-draft';
        if(action==='save') {localStorage.setItem(key,JSON.stringify(Object.fromEntries(draftFields.map(id=>[id,$('#'+id).value]))));draftStatus.textContent='Name and ticker saved. Image, settings, wallet, and approvals are not saved.';}
        else if(action==='delete') {localStorage.removeItem(key);draftStatus.textContent='Saved draft deleted. Current form is unchanged.';}
        else {const saved=JSON.parse(localStorage.getItem(key)||'null');if(!saved){draftStatus.textContent='No saved draft on this device.';return;}for(const id of draftFields){if(typeof saved[id]==='string'){const input=$('#'+id);input.value=saved[id].slice(0,input.maxLength>0?input.maxLength:100);input.dispatchEvent(new Event('input',{bubbles:true}));}}draftStatus.textContent='Name and ticker restored. Review all settings before continuing.';}
      } catch {draftStatus.textContent='Device storage is unavailable.';}
    });draftTools.append(button);
  }
  draftTools.append(draftStatus);$('[data-launch-step="1"]',page)?.append(draftTools);
  function updateReview() {
    if (!summary) return;
    summary.replaceChildren();
    for (const [label, selector, fallback] of [['Token name','#token-name','Not set'],['Ticker','#token-symbol','Not set'],['Community allocation','#preview-community','—'],['Creator buy','#preview-creator-buy','None'],['Promotion','#preview-burn-tier','Standard'],['Network','#preview-network','Devnet'],['Estimated spend','#preview-launch-cost','Unavailable']]) {
      const source = $(selector); summary.append(node('dt','',label),node('dd','',source?.value || source?.textContent || fallback));
    }
    for(const [label,id] of [['Creator wallet','#creator-wallet-share'],['Holder rewards','#holder-airdrop-share'],['X partner','#x-share']])summary.append(node('dt','',label),node('dd','',`${$(id)?.value || '0'}% of gross creator fees`));
    summary.append(node('dt','','Protocol'),node('dd','','20% of gross creator fees'));
  }
  page?.addEventListener('input',updateReview);
  window.addEventListener('funded:launch-step', updateReview);
  const preview = $('.launch-preview-sticky');
  if (preview) new MutationObserver(updateReview).observe(preview,{subtree:true,childList:true,characterData:true});
  const funding = $('#community-airdrop-help');
  const reserve = $('#community-airdrop-tokens');
  reserve?.addEventListener('input', () => {
    const amount = Number(reserve.value);
    if (funding) funding.textContent = Number.isSafeInteger(amount) ? `${amount.toLocaleString()} tokens · ${(amount / 1e9 * 100).toFixed(2)}% of supply. Allowed: 30M–500M.` : 'Enter a whole token amount between 30M and 500M.';
  });
  const route = node('div','launch-distribution-summary');
  route.innerHTML = '<div class="distribution-bar" aria-label="80 percent creator-directed; 20 percent protocol"><i></i><i></i></div><p>80% creator-directed · 20% protocol<br><small>Percentages of gross collected creator fees. Allocation is not a paid reward.</small></p>';
  $('.fee-split-fixed')?.after(route);
  // The initial step is set by the application; align first paint before any interaction.
  page.dataset.step = '1';
  $$('[data-launch-step]',page).forEach(panel=>panel.hidden=panel.dataset.launchStep!=='1');
  updateReview();
}

function rewards() {
  const root = $('#payments'); if (!root) return;
  const x = node('div'); x.id = 'rewards-x';
  while(root.firstChild) x.append(root.firstChild);
  const overview = node('div'); overview.id = 'rewards-overview';
  overview.innerHTML = '<div class="workspace-page-header"><p class="eyebrow">Your rewards</p><h1>Rewards, in one place</h1><p>Choose a reward type to check eligibility, review available amounts, and find confirmed receipts.</p></div><div class="reward-entry-grid"><button type="button" data-reward-open="creator"><strong>Creator fees</strong><span>Collected fees from your tokens</span><small>Connect your launch wallet</small></button><button type="button" data-reward-open="holder"><strong>Holder rewards</strong><span>SOL distributions and eligibility</span><small>Snapshot and funding required</small></button><button type="button" data-reward-open="x"><strong>X partner rewards</strong><span>Claims linked to your X account</span><small>X sign-in required</small></button><a href="#referrals"><strong>Referral rewards</strong><span>Qualified activity and claim receipts</span><small>Wallet attribution required</small></a><a href="#airdrops"><strong>Token airdrops</strong><span>Allocation, eligibility, and claims</span><small>Verified vault and proof required</small></a></div><p class="source-note">Allocated amounts, claimable rewards, and confirmed payments are different states. Each reward type shows its own units and evidence.</p>';
  const creator = node('div'); creator.id = 'rewards-creator';
  creator.innerHTML = '<h2>Creator rewards</h2><p>Review collected fees for the connected launch wallet. Open a token in Portfolio to request a payout when its verified threshold is met.</p><p class="reward-wallet-prompt">Connect your launch wallet to see your records.</p><a class="secondary-button" href="#my-launches">Open Portfolio →</a>';
  const personal = $('[data-personal-rewards]'); if(personal)creator.append(personal);
  const xSummary = $('[data-x-rewards]',personal || creator);if(xSummary)x.prepend(xSummary);
  const holder = node('div'); holder.id = 'rewards-holder';
  const automatic = $('[data-automatic-rewards]'); if(automatic)holder.append(automatic);
  root.append(overview,creator,holder,x);
  const select = tabs(root,[{key:'overview',label:'Overview',panel:overview},{key:'creator',label:'Creator',panel:creator},{key:'holder',label:'Holder',panel:holder},{key:'x',label:'X partner',panel:x}],'Reward type');
  $$('[data-reward-open]',root).forEach(button=>button.addEventListener('click',()=>select(button.dataset.rewardOpen,true)));
  $$('a[href="#payments"]',personal || creator).forEach(link=>link.addEventListener('click',()=>select('x',true)));
  const syncIdentity=()=>{const prompt=$('.reward-wallet-prompt'); if(prompt)prompt.hidden=Boolean(document.documentElement.dataset.connectedWallet);};
  window.addEventListener('funded:reward-identity-change',syncIdentity); syncIdentity();
  text('.x-claim-heading h2','X partner claims');
  text('.x-claim-heading > div > p:last-child','Sign in with X, choose a reward, and review the destination wallet before approving.');
}

function secondaryPages() {
  text('#referral-command-title', 'Your referral activity');
  disclose($('.referral-toolkit'), 'Campaign links and sharing tools');
  disclose($('.referral-progress-panel'), 'How referrals qualify');
  const analytics = $('#analytics-detail');
  if(analytics){const details=node('details','ui-disclosure');details.innerHTML='<summary>Data source details</summary><p id="analytics-technical-source">Source details appear after the next refresh.</p>';analytics.append(details);}
  text('#burn-center-title', '$FUNDED');
  const milestones=$('.burn-tier-progress') || $('.burn-tier-card') || $('.burn-tier-panel');
  if(milestones)milestones.prepend(node('p','field-help','Burn milestones describe wallet history. They are separate from token promotion tiers.'));
  const receipts=$('.burn-receipts-panel');
  if(receipts)receipts.prepend(node('p','field-help','Supply reduction includes all on-chain burns; this ledger includes only verified receipts available to the app. Voluntary, promotion, and fee-funded burns are distinct.'));
  disclose($('.burn-policy-preview'), 'Fee-funded buyback policy · example calculator');
  const airdrops=$('#airdrops');
  if(airdrops){
    const group=(name,selectors)=>{const panel=node('section','airdrop-workspace');for(const selector of selectors){const item=$(selector,airdrops);if(item)panel.append(item);} if(!panel.childElementCount)return; airdrops.append(panel);disclose(panel,name);};
    group('All airdrop programs',['.airdrop-directory-head','.airdrop-directory']);
    group('Creator management and distribution evidence',['.airdrop-detail-grid','.airdrop-wallets-card','.airdrop-enhancement-grid']);
    disclose($('.claim-flow',airdrops),'How eligibility becomes claimable');
  }
  const leaderboard=$('#leaderboard');
  if(leaderboard){$('.leaderboard-insight',leaderboard)?.setAttribute('hidden','');const note=node('p','source-note','Creator ranking uses confirmed launches in the available feed. Trader and referral rankings remain unavailable until their activity is verified.');leaderboard.prepend(note);}
  const docs=$('#docs');
  if(docs){const help=node('nav','workspace-shortcuts');help.setAttribute('aria-label','Help by task');help.innerHTML='<a href="#launch"><strong>How do I launch?</strong><span>Details, settings, costs, review</span></a><a href="#explore"><strong>How do I trade?</strong><span>Open a token and preview a quote</span></a><a href="#payments"><strong>Where are my rewards?</strong><span>Choose a role and check eligibility</span></a><a href="#capital-flow"><strong>Where do fees go?</strong><span>Policy calculator and receipt chain</span></a>';docs.prepend(help);}
  const account=$('#profile');
  if(account){const links=node('nav','workspace-shortcuts');links.setAttribute('aria-label','Account tools');links.innerHTML='<a href="#creator-settings"><strong>Linked X account</strong><span>Creator identity and preferences</span></a><a href="#payments"><strong>Rewards & receipts</strong><span>Review the connected wallet’s activity</span></a>';account.append(links);}
}

function tokenPage() {
  const root=$('#coin-page');if(!root)return;
  const layout=$('.coin-layout',root);
  const chart=$('.coin-chart-panel',root);const column=chart?.parentElement;
  if(column)column.prepend(chart);
  const hero=$('.coin-hero-card',root);
  const description=$('#coin-description',root);
  if(hero&&description){
    const about=node('div','coin-hero-about');
    about.append(node('span','coin-hero-about-label','About this token'),description);
    hero.append(about);
  }
  const accounting=node('section','token-accounting');accounting.id='token-accounting';
  const fees=$('.coin-fee-dashboard',root);const metrics=$('#coin-summary-dashboard');
  if(fees)accounting.append(fees);if(metrics)accounting.append(metrics);
  if(layout){layout.after(accounting);disclose(accounting,'Rewards, creator claims, and allocation records');}
  const trade=$('#trade-panel',root);
  const pulse=$('.coin-pulse-panel',root);
  const side=$('.coin-side-column',root);
  if(trade&&pulse&&side)trade.after(pulse);
  const curve=$('.coin-curve-track',root);
  const flow=$('.coin-flow',root);
  if(pulse&&curve&&flow){
    const market=node('section','panel coin-market-aside');
    market.append(node('h2','coin-market-aside-title','Bonding curve'),curve,flow);
    pulse.after(market);
  }
  const policy=$('.coin-policy-card',root);
  if(policy){
    const facts=disclose(policy,'On-chain facts and addresses');
    if(facts)facts.open=true;
  }
  $$('.coin-section-nav button',root).forEach(button=>button.addEventListener('click',()=>{
    if(button.textContent==='On-chain checks' && policy?.parentElement.tagName==='DETAILS')policy.parentElement.open=true;
  },true));
  const slippage=$('#trade-slippage')?.closest('label');disclose(slippage,'Trade settings · slippage');
  const button=node('button','mobile-trade-open','Trade token');button.type='button';
  const sheetBackground = new Map();
  const setSheet = open => {
    root.classList.toggle('trade-sheet-open',open);button.setAttribute('aria-expanded',String(open));
    if(open){
      for(let branch=trade;branch?.parentElement;branch=branch.parentElement){for(const sibling of branch.parentElement.children){if(sibling!==branch&&sibling.tagName!=='DIALOG'&&!sheetBackground.has(sibling)){sheetBackground.set(sibling,sibling.inert);sibling.inert=true;}}if(branch.parentElement===document.body)break;}
      trade?.setAttribute('role','dialog');trade?.setAttribute('aria-modal','true');trade?.setAttribute('aria-label','Trade token');trade?.setAttribute('tabindex','-1');trade?.focus();
    }
    else {for(const [element,inert] of sheetBackground)element.inert=inert;sheetBackground.clear();trade?.removeAttribute('role');trade?.removeAttribute('aria-modal');trade?.removeAttribute('aria-label');}
  };
  button.addEventListener('click',()=>setSheet(!root.classList.contains('trade-sheet-open')));
  button.setAttribute('aria-controls','trade-panel');button.setAttribute('aria-expanded','false');root.append(button);
  $$('.coin-section-nav button',root).filter(item=>item.textContent.trim()==='Trade').forEach(item=>item.addEventListener('click',()=>{if(matchMedia('(max-width:700px)').matches)setSheet(true);}));
  const close=node('button','mobile-trade-close','Close trade');close.type='button';close.addEventListener('click',()=>{setSheet(false);button.focus();});trade?.prepend(close);
  window.addEventListener('hashchange',()=>setSheet(false));
  matchMedia('(max-width:700px)').addEventListener('change',()=>setSheet(false));
  trade?.addEventListener('keydown',event=>{
    if(!root.classList.contains('trade-sheet-open')||!matchMedia('(max-width:700px)').matches)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.click();return;}
    if(event.key==='Tab'){const controls=$$('button,a,input,select,summary',trade).filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===trade)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
}

function syncRoute() {
  const route=location.hash.slice(1)||'overview';
  const tokenOrWallet = /^\/(token|wallet|launch\/coin)\//.test(location.pathname) && !location.hash || route.startsWith('coin/');
  $$('[data-workspace-route]').forEach(element => { element.hidden = tokenOrWallet || element.dataset.workspaceRoute !== route; });
  $$('.mobile-workspace-nav a').forEach(link=>{if(link.hash===location.hash)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  const more=$('.nav-more');if(more)more.open=Boolean($('a[aria-current="page"]',more));
  const target=$('#route-guide');if(target&&['payments','my-launches','community','profile'].includes(route))target.hidden=true;
  if(route==='community'){text('#community h2','Watchlist');}
  if(route==='payments')document.title='Rewards · funded.vip';
  else if(route==='launch')document.title='Launch token · funded.vip';
  else document.title=`${$('[data-route-label]')?.textContent||'funded.vip'} · funded.vip`;
}

navigation(); home(); explore(); launch(); rewards(); secondaryPages(); tokenPage();
document.body.classList.add('workspace-ready');
window.addEventListener('funded:route-change',syncRoute);
window.addEventListener('hashchange',syncRoute);
syncRoute();
