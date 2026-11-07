import {tokenBurnSummary} from './burn-summary-model.js';
import {burnDashboardMarkup} from './burn-dashboard-markup.js';

export function renderCoinBurnDashboard({status,mint,cluster='devnet',checkedAt,...snapshot}={},document=globalThis.document){
  if(!document?.querySelector('#coin-burn-dashboard'))document?.querySelector('#coin-summary-dashboard')?.insertAdjacentHTML('beforeend',burnDashboardMarkup);
  const root=document?.querySelector('#coin-burn-dashboard');if(!root)return;
  const details=root.querySelector('details');
  if(root.dataset.mint!==String(mint||''))details.open=false;
  root.dataset.mint=mint||'';
  const model=status==='loading'?{status:'loading'}:status==='unavailable'?{status,reason:'Burn totals could not be checked. Refresh token data to retry.'}:tokenBurnSummary({mint,...snapshot});
  root.dataset.state=model.status;root.setAttribute('aria-busy',String(model.status==='loading'));
  const set=(key,value)=>{root.querySelector(`[data-burn-${key}]`).textContent=value;};
  set('tokens',model.status==='ready'?model.burnedTokens:'—');set('percent',model.status==='ready'?model.burnedPercent:'—');
  set('initial',model.status==='ready'?`${model.initialTokens} tokens`:'Unavailable');
  set('current',model.status==='ready'?`${model.currentTokens} tokens`:'Unavailable');
  set('status',model.status==='loading'?'Checking token burn totals…':model.status==='ready'?'Confirmed supply snapshot':model.reason);
  const time=root.querySelector('[data-burn-checked]');time.textContent=model.status==='ready'&&Number.isFinite(checkedAt)?new Date(checkedAt).toLocaleString():'Unavailable';
  const link=root.querySelector('[data-burn-explorer]');link.hidden=!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint||'');
  if(!link.hidden)link.href=`https://explorer.solana.com/address/${encodeURIComponent(mint)}${cluster==='devnet'?'?cluster=devnet':''}`;
  else link.removeAttribute('href');
  syncCoinBurnCards(document);
}

export function syncCoinBurnCards(document=globalThis.document){
  const root=document?.querySelector('#coin-burn-dashboard'),grid=document?.querySelector('#coin-summary-grid');if(!root||!grid)return;
  const symbol=document.querySelector('#coin-symbol')?.textContent?.trim()||'Tokens';
  for(const [key,label,unit,note] of [['tokens','Total tokens burned',symbol,root.querySelector('[data-burn-status]').textContent],['percent','Total supply burned','', 'Of original supply']]){
    let card=grid.querySelector(`[data-token-burn-metric="${key}"]`);
    if(!card){card=document.createElement('article');card.className='coin-summary-card';card.dataset.tokenBurnMetric=key;card.innerHTML='<span class="coin-summary-icon" aria-hidden="true">♨</span><div><small></small><span class="coin-summary-value"><strong></strong><b></b></span><em></em></div>';grid.append(card);}
    card.dataset.state=root.dataset.state==='ready'?'available':'unavailable';card.dataset.metric=key==='tokens'?'token-burn':'supply-burn';
    card.querySelector('small').textContent=label;card.querySelector('strong').textContent=root.querySelector(`[data-burn-${key}]`).textContent;
    card.querySelector('b').textContent=unit;card.querySelector('b').hidden=!unit;card.querySelector('em').textContent=note;
  }
}
