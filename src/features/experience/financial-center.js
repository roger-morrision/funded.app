import { financialRows, newestFirst } from './financial-model.js';
import { initializeReadyQueue } from './ready-queue.js';
import { renderFinancialRecords } from './financial-activity-view.js';
import {focusFilterRecovery} from '../shared/filter-recovery.js';
import {missingFinancialSources,financialEmptyMessage} from './financial-empty-state.js';
const stages = ['Accrued', 'Awaiting approval', 'Funded', 'Processing', 'Verified'];
export function initializeFinancialCenter(app) {
  const parent = document.querySelector('#rewards-overview');
  if (!parent) return;
  const root = document.createElement('section'); root.id = 'financial-center'; root.className = 'flow-panel';
  root.setAttribute('aria-labelledby', 'financial-center-title');
  root.innerHTML = '<header class="financial-heading"><div><p class="eyebrow">Recorded activity</p><h2 id="financial-center-title">Rewards &amp; burns</h2><p>Your payments, creator approvals and public burn receipts.</p></div><button type="button" data-flow-refresh>Refresh activity</button></header><div class="financial-toolbar"><label>Status <select data-flow-filter><option value="all">All activity</option><option>Awaiting approval</option><option>Processing</option><option>Funded</option><option>Verified</option><option>Accrued</option></select></label><span data-flow-count></span><span data-flow-checked></span></div><p data-flow-status class="financial-status" role="status" aria-live="polite">Loading recorded activity…</p><div data-flow-rows></div><div class="financial-empty" data-flow-empty hidden><p data-flow-empty-title>No recorded activity loaded.</p><p data-flow-empty-note>Unavailable data is not a zero balance.</p><button type="button" data-flow-reset hidden>Show all activity</button></div><div class="financial-list-footer"><button type="button" data-flow-more hidden>Show more activity</button><small>Expand a record for evidence and full addresses.</small></div><details class="financial-help"><summary>Reward programs &amp; payment rules</summary><p>Active automatic routes handle saved-policy settlement and payouts. Manual approvals require the launch wallet. X sign-in is needed for X claims.</p><p data-flow-scope>Connect a wallet for personal rewards. Public protocol burns are shown here.</p><nav aria-label="Financial activity"><a href="#bonuses">Daily bonuses</a><a href="#airdrops">Airdrops</a><a href="#buybacks">Buyback &amp; burn</a><a href="#referrals">Referrals</a></nav></details><ol class="flow-stages">' + stages.map(stage => `<li>${stage}</li>`).join('') + '</ol><p class="flow-note">These are separate evidence stages. A cutoff determines eligibility; processing follows funding and verification. Daily top-three bonuses stay ranked until their window closes. Each trade can wake ready work.</p>';
  parent.append(root);
  root.querySelector('#financial-center-title').textContent = 'Reward activity';
  root.querySelector('.financial-heading p:not(.eyebrow)').textContent = 'Your recorded payments and creator approvals. Public protocol records are separate.';
  const scope = document.createElement('label'); scope.className = 'financial-scope-control';
  scope.innerHTML = 'Show <select data-flow-scope-filter aria-label="Activity scope"><option value="personal">My wallet activity</option><option value="protocol">Protocol activity · public</option></select>';
  root.querySelector('.financial-heading').after(scope);
  const scopeControl = scope.querySelector('select');
  const renderReady = initializeReadyQueue(root,app);
  const ready = (rows,options) => {
    renderReady(rows,options);
    if(scopeControl.value==='protocol')root.querySelector('.ready-queue').hidden=true;
  };
  let request = 0, lastKey = '', lastAt = 0, rows = [], loading = false, limit = 10, hasLoaded = false, missingSources=[];
  const expanded=new Set();
  const status = root.querySelector('[data-flow-status]'), list = root.querySelector('[data-flow-rows]');
  const refreshButton=root.querySelector('[data-flow-refresh]'),more=root.querySelector('[data-flow-more]');
  const empty=root.querySelector('[data-flow-empty]'),reset=root.querySelector('[data-flow-reset]'),filterControl=root.querySelector('[data-flow-filter]');
  function render({preserveRows=false}={}) {
    list.setAttribute('aria-busy',String(loading));
    refreshButton.disabled=loading;refreshButton.textContent=loading?'Refreshing…':'Refresh activity';
    more.disabled=loading;
    if(preserveRows)return;
    const filter = filterControl.value;
    const personal = scopeControl.value === 'personal';
    const scoped = rows.filter(row => personal ? Boolean(app.connectedWalletAddress) && row.wallet === app.connectedWalletAddress : !row.wallet);
    const missing = missingSources.filter(source => personal ? source !== 'buybacks' : source === 'buybacks');
    const selected = newestFirst(scoped.filter(row => filter === 'all' || row.stage === filter));
    renderFinancialRecords(list,selected.slice(0,limit),expanded,root.querySelector('#financial-center-title'));
    // "0 of 0" would repeat the empty-state message, so the count stays blank.
    root.querySelector('[data-flow-count]').textContent=loading?'':selected.length?`${Math.min(limit,selected.length)} of ${selected.length} loaded records`:missing.length&&(!personal||app.connectedWalletAddress)?'Records unavailable':'';
    root.querySelector('.financial-list-footer').hidden=!selected.length||loading;
    // A status filter over zero loaded records only adds noise (common with no wallet connected).
    filterControl.closest('label').hidden=hasLoaded&&!loading&&!scoped.length&&filterControl.value==='all';
    more.hidden=loading||selected.length<=limit||limit>=60;
    const active=document.activeElement,owned=empty.contains(active);
    empty.hidden=selected.length>0||loading||!hasLoaded;reset.hidden=filter==='all';
    const message=personal&&!app.connectedWalletAddress
      ? {kind:'disconnected',title:'Connect a wallet to see your activity.',note:'Your SOL payments and creator approvals appear here. Token claims are listed under Token airdrops.'}
      : financialEmptyMessage(scoped.length>0,missing);
    root.dataset.state=loading?'loading':!hasLoaded?'idle':selected.length?'ready':message.kind;
    root.querySelector('[data-flow-empty-title]').textContent=message.title;
    root.querySelector('[data-flow-empty-note]').textContent=message.note;
    status.textContent = personal
      ? app.connectedWalletAddress ? `Recorded activity for ${app.connectedWalletAddress}. Not a live balance.${missing.length ? ' Unavailable: '+missing.join(', ')+'.' : ''}` : 'Personal activity · no wallet connected.'
      : `Public protocol allocations and burns. These amounts are not your rewards.${missing.length ? ' Unavailable: buybacks.' : ''}`;
    root.querySelector('[data-flow-scope]').textContent = personal ? 'Only records belonging to the connected wallet are shown. Claims and eligibility remain in their program pages.' : 'Public protocol records. An allocation is not an executed buyback or payment.';
    const queue=root.querySelector('.ready-queue'); if(queue&& !personal)queue.hidden=true;
    if(owned&&empty.hidden&&(document.activeElement===active||document.activeElement===document.body)){const heading=root.querySelector('#financial-center-title');heading.tabIndex=-1;focusFilterRecovery(heading);}
    if (selected.length > 60 && limit>=60) list.append(Object.assign(document.createElement('p'), { textContent:'Showing 60 records. Open the program pages for more history.' }));
  }
  async function refresh(force = false) {
    // #rewards and #funded-holder-token-rewards are shared-link aliases for the payments route.
    if (document.hidden || !/^#(?:payments|rewards$|funded-holder-token-rewards$)/.test(location.hash)) return;
    const wallet = app.connectedWalletAddress || '', key = wallet;
    if (!force && lastKey === key && Date.now() - lastAt < 30000) return;
    lastKey = key; lastAt = Date.now(); const id = ++request;
    loading = true; render({preserveRows:hasLoaded}); ready([],{checking:!!wallet}); status.textContent = hasLoaded?'Refreshing activity… Showing previously loaded records.':'Loading recorded activity…';root.querySelector('[data-flow-checked]').textContent='';
    const read = path => app.apiRequest(path, { signal:AbortSignal.timeout(18000) }).catch(() => null);
    const [experience, burns, bonus] = await Promise.all([read(`/api/rewards/experience${wallet ? '?wallet=' + encodeURIComponent(wallet) : ''}`), read('/api/buyback/status'),read('/api/daily-bonus')]);
    if (id !== request || wallet !== (app.connectedWalletAddress || '')) return;
    const owned = experience?.data?.wallet?.address === wallet ? (experience.data.wallet.rows || []).filter(row => row.creator).slice(0, 8) : [];
    const overviews = await Promise.all(owned.map(row => read(`/api/tokens/${encodeURIComponent(row.mint)}/fee-activity`)));
    if (id !== request || wallet !== (app.connectedWalletAddress || '')) return;
    const missing=missingFinancialSources(experience,burns,overviews,wallet);missingSources=missing;
    rows = financialRows({ experience:experience?.available ? experience.data : null, buybacks:burns?.available ? burns.data : null,
      overviews:overviews.filter(row => row?.available && row.data?.cluster === 'devnet').map(row => ({ ...row.data?.overview, mint:row.data?.mint })), wallet }); loading = false; hasLoaded = true; render();
    ready(rows,{missing,cutoff:bonus?.data?.cluster === 'devnet' ? bonus.data.nextCutoffAt : null});
    window.dispatchEvent(new CustomEvent('funded:financial-center-data',{detail:{wallet,rows,missing,experience:experience?.data,buybacks:burns?.data,cutoff:bonus?.data?.cluster==='devnet'?bonus.data.nextCutoffAt:null}}));
    render();
    if (wallet && owned.length === 8 && scopeControl.value === 'personal') status.textContent += ' First 8 creator launches checked; inspect Portfolio for others.';
    root.querySelector('[data-flow-checked]').textContent=`Updated ${new Date().toLocaleTimeString()}`;
  }
  filterControl.addEventListener('change', () => {limit=10;render();});
  scopeControl.addEventListener('change', () => {limit=10;filterControl.value='all';expanded.clear();ready(rows,{missing:missingSources});render();});
  reset.addEventListener('click',()=>{const owned=reset.contains(document.activeElement);filterControl.value='all';limit=10;render();if(owned)focusFilterRecovery(filterControl);});
  more.addEventListener('click',()=>{limit=Math.min(60,limit+10);render();});
  root.querySelector('[data-flow-refresh]').addEventListener('click', () => void refresh(true));
  window.addEventListener('hashchange', () => void refresh());
  window.addEventListener('funded:route-change', () => void refresh());
  // Wallet-state updates (and X claim summaries) fire this event even when the
  // wallet is unchanged; only a different wallet should reset these records.
  let identity = app.connectedWalletAddress || '';
  window.addEventListener('funded:reward-identity-change', () => { const wallet = app.connectedWalletAddress || ''; if (wallet === identity) return; identity = wallet; ++request; loading = false; rows = []; limit=10; hasLoaded=false; missingSources=[]; expanded.clear(); render(); ready(rows,{checking:!!app.connectedWalletAddress}); root.querySelector('[data-flow-scope]').textContent=wallet?'Checking rewards for this wallet…':'';root.querySelector('[data-flow-checked]').textContent='';status.textContent = wallet ? 'Wallet changed. Loading activity for this wallet…' : 'Wallet disconnected. Loading public activity…'; void refresh(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => void refresh(), 60000); void refresh();
}
