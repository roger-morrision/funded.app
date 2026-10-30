import { financialRows } from './financial-model.js';
import { initializeReadyQueue } from './ready-queue.js';
import { receiptUrl } from './receipt-inspector.js';
const stages = ['Accrued', 'Awaiting approval', 'Funded', 'Processing', 'Verified'];
export function initializeFinancialCenter(app) {
  const parent = document.querySelector('#rewards-overview');
  if (!parent) return;
  const root = document.createElement('section'); root.id = 'financial-center'; root.className = 'flow-panel';
  root.setAttribute('aria-labelledby', 'financial-center-title');
  root.innerHTML = '<header><div><p class="eyebrow">Rewards &amp; Burns</p><h2 id="financial-center-title">From fees to verified delivery</h2><p>Wallet rewards and public protocol burns. Approval belongs to the launch creator; X is needed only for X claims.</p></div><button type="button" data-flow-refresh>Refresh activity</button></header><ol class="flow-stages">' + stages.map(stage => `<li>${stage}</li>`).join('') + '</ol><p class="flow-note">These are separate evidence stages. A cutoff determines eligibility; processing follows funding and verification. Daily top-three bonuses stay ranked until their window closes. Each trade can wake ready work.</p><nav aria-label="Financial activity"><a href="#bonuses">Ranked bonus windows</a><a href="#airdrops">Token eligibility &amp; claims</a><a href="#buybacks">Buyback vaults &amp; receipts</a><a href="#referrals">Referral receipts</a></nav><label>Show <select data-flow-filter><option value="all">All activity</option><option>Awaiting approval</option><option>Processing</option><option>Funded</option><option>Verified</option><option>Accrued</option></select></label><p data-flow-status role="status" aria-live="polite">Open Rewards to check activity.</p><div data-flow-rows></div>';
  parent.prepend(root);
  const ready = initializeReadyQueue(root,app);
  let request = 0, lastKey = '', lastAt = 0, rows = [];
  const status = root.querySelector('[data-flow-status]'), list = root.querySelector('[data-flow-rows]');
  function render() {
    list.replaceChildren(); const filter = root.querySelector('select').value;
    const selected = rows.filter(row => filter === 'all' || row.stage === filter);
    for (const row of selected.slice(0, 60)) {
      const item = document.createElement('article'); item.className = 'flow-activity-row'; item.dataset.stage = row.stage;
      const title = document.createElement('h3'); title.textContent = row.title;
      const stage = document.createElement('span'); stage.className = 'flow-stage'; stage.textContent = row.stage;
      const value = document.createElement('strong'); value.textContent = row.amount;
      const detail = document.createElement('p'); detail.textContent = row.detail;
      const context = document.createElement('small'); context.textContent = `Mint ${row.mint}${row.wallet ? ' · Wallet ' + row.wallet : ''}${row.at ? ' · ' + row.at : ''}`;
      const link = document.createElement('a'); link.textContent = row.signature ? 'View verified transaction ↗' : row.action;
      link.href = row.signature ? `https://explorer.solana.com/tx/${row.signature}?cluster=devnet` : row.href;
      if (row.signature && row.receiptView!=='explorer') { link.href = receiptUrl(row.signature,row.mint,row.wallet); link.textContent = 'Inspect exact receipt'; }
      else if(row.signature){link.textContent='Inspect on-chain policy burn ↗';link.target='_blank';link.rel='noopener noreferrer';}
      item.append(stage, title, value, detail, context, link); list.append(item);
    }
    if (!selected.length) list.textContent = 'No matching recorded activity. Unavailable data is not a zero balance.';
    else if (selected.length > 60) list.append(Object.assign(document.createElement('p'), { textContent:'Showing 60 records. Open the program pages for more history.' }));
  }
  async function refresh(force = false) {
    if (document.hidden || !location.hash.startsWith('#payments')) return;
    const wallet = app.connectedWalletAddress || '', key = wallet;
    if (!force && lastKey === key && Date.now() - lastAt < 30000) return;
    lastKey = key; lastAt = Date.now(); const id = ++request;
    rows = []; render(); ready(rows,{checking:true}); status.textContent = 'Checking recorded V3 activity…';
    const read = path => app.apiRequest(path, { signal:AbortSignal.timeout(18000) }).catch(() => null);
    const [experience, burns, bonus] = await Promise.all([read(`/api/rewards/experience${wallet ? '?wallet=' + encodeURIComponent(wallet) : ''}`), read('/api/buyback/status'),read('/api/daily-bonus')]);
    if (id !== request || wallet !== (app.connectedWalletAddress || '')) return;
    const owned = experience?.data?.wallet?.address === wallet ? (experience.data.wallet.rows || []).filter(row => row.creator).slice(0, 8) : [];
    const overviews = await Promise.all(owned.map(row => read(`/api/tokens/${encodeURIComponent(row.mint)}/fee-activity`)));
    if (id !== request || wallet !== (app.connectedWalletAddress || '')) return;
    rows = financialRows({ experience:experience?.available ? experience.data : null, buybacks:burns?.available ? burns.data : null,
      overviews:overviews.filter(row => row?.available && row.data?.cluster === 'devnet').map(row => ({ ...row.data?.overview, mint:row.data?.mint })), wallet }); render();
    const missing = [!experience?.available && 'rewards', !burns?.available && 'buybacks', overviews.some(row => !row?.available) && 'creator approvals'].filter(Boolean);
    ready(rows,{missing,cutoff:bonus?.data?.cluster === 'devnet' ? bonus.data.nextCutoffAt : null});
    window.dispatchEvent(new CustomEvent('funded:financial-center-data',{detail:{wallet,rows,missing,experience:experience?.data,buybacks:burns?.data,cutoff:bonus?.data?.cluster==='devnet'?bonus.data.nextCutoffAt:null}}));
    status.textContent = `${wallet ? 'Wallet ' + wallet : 'Connect your wallet for personal rewards; public burns shown.'} · Checked ${new Date().toLocaleTimeString()}${missing.length ? ' · Unavailable: ' + missing.join(', ') : ' · Recorded evidence, not a current balance check.'}${owned.length === 8 ? ' · First 8 creator launches checked; inspect Portfolio for others.' : ''}`;
  }
  root.querySelector('select').addEventListener('change', render);
  root.querySelector('[data-flow-refresh]').addEventListener('click', () => void refresh(true));
  window.addEventListener('hashchange', () => void refresh());
  window.addEventListener('funded:route-change', () => void refresh());
  window.addEventListener('funded:reward-identity-change', () => { ++request; rows = []; render(); ready(rows,{checking:!!app.connectedWalletAddress}); status.textContent = 'Wallet changed. Open Rewards to check this wallet.'; void refresh(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => void refresh(), 60000); void refresh();
}
