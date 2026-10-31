import { financialRows } from './financial-model.js';
import { initializeReadyQueue } from './ready-queue.js';
import { renderFinancialRecords } from './financial-activity-view.js';
const stages = ['Accrued', 'Awaiting approval', 'Funded', 'Processing', 'Verified'];
export function initializeFinancialCenter(app) {
  const parent = document.querySelector('#rewards-overview');
  if (!parent) return;
  const root = document.createElement('section'); root.id = 'financial-center'; root.className = 'flow-panel';
  root.setAttribute('aria-labelledby', 'financial-center-title');
  root.innerHTML = '<header class="financial-heading"><div><p class="eyebrow">Recorded activity</p><h2 id="financial-center-title">Rewards &amp; burns</h2><p>Track recorded payments, creator approvals and public burn receipts.</p></div><button type="button" data-flow-refresh>Refresh activity</button></header><div class="financial-toolbar"><label>Status <select data-flow-filter><option value="all">All activity</option><option>Awaiting approval</option><option>Processing</option><option>Funded</option><option>Verified</option><option>Accrued</option></select></label><span data-flow-count></span><span data-flow-checked></span></div><p data-flow-status class="financial-status" role="status" aria-live="polite">Open Rewards to check activity.</p><div data-flow-rows></div><div class="financial-list-footer"><button type="button" data-flow-more hidden>Show more activity</button><small>Expand a record for evidence and full addresses.</small></div><details class="financial-help"><summary>Reward programs &amp; payment rules</summary><p>Creator approvals require the launch wallet. X sign-in is only needed for X claims.</p><p data-flow-scope>Connect a wallet for personal rewards. Public protocol burns are shown here.</p><nav aria-label="Financial activity"><a href="#bonuses">Daily bonuses</a><a href="#airdrops">Airdrops</a><a href="#buybacks">Buyback &amp; burn</a><a href="#referrals">Referrals</a></nav></details><ol class="flow-stages">' + stages.map(stage => `<li>${stage}</li>`).join('') + '</ol><p class="flow-note">These are separate evidence stages. A cutoff determines eligibility; processing follows funding and verification. Daily top-three bonuses stay ranked until their window closes. Each trade can wake ready work.</p>';
  parent.append(root);
  const ready = initializeReadyQueue(root,app);
  let request = 0, lastKey = '', lastAt = 0, rows = [], loading = false, limit = 10;
  const expanded=new Set();
  const status = root.querySelector('[data-flow-status]'), list = root.querySelector('[data-flow-rows]');
  const refreshButton=root.querySelector('[data-flow-refresh]'),more=root.querySelector('[data-flow-more]');
  function render({preserveRows=false}={}) {
    list.setAttribute('aria-busy',String(loading));
    refreshButton.disabled=loading;refreshButton.textContent=loading?'Refreshing…':'Refresh activity';
    more.disabled=loading;
    if(preserveRows)return;
    const filter = root.querySelector('select').value;
    const selected = rows.filter(row => filter === 'all' || row.stage === filter);
    renderFinancialRecords(list,selected.slice(0,limit),expanded,root.querySelector('#financial-center-title'));
    root.querySelector('[data-flow-count]').textContent=loading?'':`${Math.min(limit,selected.length)} of ${selected.length} loaded records`;
    more.hidden=loading||selected.length<=limit||limit>=60;
    if (!selected.length && !loading) {const empty=document.createElement('p');empty.className='financial-empty';empty.textContent='No matching recorded activity. Unavailable data is not a zero balance.';list.append(empty);}
    else if (selected.length > 60 && limit>=60) list.append(Object.assign(document.createElement('p'), { textContent:'Showing 60 records. Open the program pages for more history.' }));
  }
  async function refresh(force = false) {
    if (document.hidden || !location.hash.startsWith('#payments')) return;
    const wallet = app.connectedWalletAddress || '', key = wallet;
    if (!force && lastKey === key && Date.now() - lastAt < 30000) return;
    lastKey = key; lastAt = Date.now(); const id = ++request;
    loading = true; render({preserveRows:rows.length>0}); ready([],{checking:!!wallet}); status.textContent = rows.length?'Refreshing activity… Showing previously loaded records.':'Loading recorded activity…';root.querySelector('[data-flow-checked]').textContent='';
    const read = path => app.apiRequest(path, { signal:AbortSignal.timeout(18000) }).catch(() => null);
    const [experience, burns, bonus] = await Promise.all([read(`/api/rewards/experience${wallet ? '?wallet=' + encodeURIComponent(wallet) : ''}`), read('/api/buyback/status'),read('/api/daily-bonus')]);
    if (id !== request || wallet !== (app.connectedWalletAddress || '')) return;
    const owned = experience?.data?.wallet?.address === wallet ? (experience.data.wallet.rows || []).filter(row => row.creator).slice(0, 8) : [];
    const overviews = await Promise.all(owned.map(row => read(`/api/tokens/${encodeURIComponent(row.mint)}/fee-activity`)));
    if (id !== request || wallet !== (app.connectedWalletAddress || '')) return;
    rows = financialRows({ experience:experience?.available ? experience.data : null, buybacks:burns?.available ? burns.data : null,
      overviews:overviews.filter(row => row?.available && row.data?.cluster === 'devnet').map(row => ({ ...row.data?.overview, mint:row.data?.mint })), wallet }); loading = false; render();
    const missing = [!experience?.available && 'rewards', !burns?.available && 'buybacks', overviews.some(row => !row?.available) && 'creator approvals'].filter(Boolean);
    ready(rows,{missing,cutoff:bonus?.data?.cluster === 'devnet' ? bonus.data.nextCutoffAt : null});
    window.dispatchEvent(new CustomEvent('funded:financial-center-data',{detail:{wallet,rows,missing,experience:experience?.data,buybacks:burns?.data,cutoff:bonus?.data?.cluster==='devnet'?bonus.data.nextCutoffAt:null}}));
    status.textContent = `${wallet ? 'Activity for your connected wallet.' : 'Public protocol burns shown.'} Recorded evidence, not a current balance check.${missing.length ? ' · Unavailable: ' + missing.join(', ') : ''}${owned.length === 8 ? ' · First 8 creator launches checked; inspect Portfolio for others.' : ''}`;
    root.querySelector('[data-flow-scope]').textContent=wallet?`Wallet ${wallet}. Personal receipts are scoped to this wallet; public protocol burns are also included.`:'Connect a wallet for personal rewards. Public protocol burns are shown here.';
    root.querySelector('[data-flow-checked]').textContent=`Updated ${new Date().toLocaleTimeString()}`;
  }
  root.querySelector('select').addEventListener('change', () => {limit=10;render();});
  more.addEventListener('click',()=>{limit=Math.min(60,limit+10);render();});
  root.querySelector('[data-flow-refresh]').addEventListener('click', () => void refresh(true));
  window.addEventListener('hashchange', () => void refresh());
  window.addEventListener('funded:route-change', () => void refresh());
  window.addEventListener('funded:reward-identity-change', () => { ++request; loading = false; rows = []; limit=10; expanded.clear(); render(); ready(rows,{checking:!!app.connectedWalletAddress}); root.querySelector('[data-flow-scope]').textContent='Open Rewards to check this wallet.';root.querySelector('[data-flow-checked]').textContent='';status.textContent = 'Wallet changed. Open Rewards to check this wallet.'; void refresh(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => void refresh(), 60000); void refresh();
}
