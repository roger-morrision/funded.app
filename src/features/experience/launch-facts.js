import {savedFeeDistributionRows} from '../fees/saved-distribution-chart.js';
import {feeBenefitDetailsMarkup} from '../fees/benefit-details.js';
import { mountReserveFacts } from './reserve-facts.js';
import { link, el, address } from './view-utils.js';
export function identityMatches(candidate, launches) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = normalize(candidate.name), symbol = normalize(candidate.symbol);
  return launches.filter(row => row.mint !== candidate.mint && (name && normalize(row.name) === name
    || symbol && normalize(row.symbol) === symbol || candidate.imageUri && row.imageUri === candidate.imageUri)).slice(0, 5);
}
export function initializeLaunchFacts(app) {
  const coin = document.querySelector('#coin-page'); if (!coin) return;
  const panel = coin.querySelector('#coin-fee-distribution'); if (!panel) return;
  const root = document.createElement('div'); root.className = 'coin-fee-policy launch-facts';
  // The parent panel owns the saved allocation chart; keep its supporting rules together.
  root.innerHTML = '<details class="fee-distribution-details" data-facts-benefits hidden><summary>Benefits &amp; policy details</summary><div></div></details>';
  panel.append(root);
  mountReserveFacts(root,app);
  const reset = () => { const benefits=root.querySelector('[data-facts-benefits]'); benefits.hidden=true; benefits.open=false; benefits.querySelector('div').replaceChildren(); };
  window.addEventListener('funded:coin-facts-loading', reset);
  window.addEventListener('funded:coin-facts', event => {
    const { mint, launch, error } = event.detail;
    if (mint !== app.getCoinMintAddress()) return;
    if (error) { reset(); return; }
    const rows=savedFeeDistributionRows(launch),benefits=root.querySelector('[data-facts-benefits]');
    benefits.hidden=!rows;
    if(rows)benefits.querySelector('div').innerHTML=feeBenefitDetailsMarkup([
      {key:'creator',label:'Creator, holders & X account',percent:rows.filter(row=>['creator','holders','x'].includes(row.key)).reduce((n,row)=>n+row.percent,0)},
      ...rows.filter(row=>!['creator','holders','x'].includes(row.key)).map(row=>({...row,key:row.key==='bonus'?'community':row.key})),
    ]);
  });
  const name = document.querySelector('#token-name'), symbol = document.querySelector('#token-symbol');
  const warning = document.createElement('p'); warning.className = 'flow-note'; warning.setAttribute('role', 'status'); symbol?.closest('label')?.after(warning);
  const sync = () => { const matches = identityMatches({ name:name?.value, symbol:symbol?.value }, app.verifiedLaunchPolicies); warning.textContent = matches.length ? 'Similar name or ticker already appears in the loaded launch directory. Review those full mint addresses; this is advisory and does not block your launch.' : '';for(const match of matches.filter(row=>address(row.mint)))warning.append(el('br'),link(`${match.name||match.symbol||'Listed token'} · ${match.mint}`,`/token/${match.mint}`)); };
  name?.addEventListener('input', sync); symbol?.addEventListener('input', sync);
}
