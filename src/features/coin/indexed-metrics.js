import {completeTradeCount,marketValuation} from '../../../market-metrics.js';

export function renderIndexedMetricFields(appState,data,{document=globalThis.document}={}) {
  const valuation=marketValuation(data);
  const amount=valuation.value==null?'Unavailable':Math.abs(valuation.value)>=1000
    ? `$${Math.round(valuation.value).toLocaleString('en-US')}`:appState.formatUsd(valuation.value);
  for(const selector of ['#coin-market-cap','#coin-strip-market-cap'])appState.setCoinField(selector,amount);
  appState.setCoinField('#coin-market-cap-label',valuation.label);
  const stripLabel=document.querySelector('#coin-strip-market-cap')?.previousElementSibling;
  if(stripLabel)stripLabel.textContent=valuation.label;
  const total=completeTradeCount(data.buyCount24h,data.sellCount24h);
  appState.setCoinField('#coin-strip-trades',total==null?'Unavailable':total.toLocaleString('en-US'));
  renderHolderCount(appState,data,{document});
  const burnCell=document.querySelector('#coin-strip-burn-cell');
  if(burnCell){
    burnCell.hidden=false;
    const verified=data.burnedSupplyVerified===true&&Number.isFinite(data.burnedTokens)&&Number.isFinite(data.burnedPercent);
    appState.setCoinField('#coin-strip-burned',verified?`${new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(data.burnedTokens)} · ${data.burnedPercent.toFixed(2)}%`:'Unavailable');
    burnCell.title=verified?'Verified burned supply':'A verified initial supply or complete burn history is unavailable.';
  }
}
export function renderHolderCount(appState,data,{document=globalThis.document}={}) {
  const count=Number.isSafeInteger(data.holderCount)&&data.holderCount>=0?data.holderCount:null;
  appState.setCoinField('#coin-holder-count',count==null?'Unavailable':`${data.holderCountStale?'≈':''}${count.toLocaleString('en-US')}`);
  if(appState.coinActivity){appState.coinActivity.holderCount=count??'—';appState.setCoinTabLabels?.();}
  const holder=document.querySelector('#coin-holder-count');
  if(holder){
    const at=data.holderCountAsOf||data.holderCountCheckedAt;
    const time=Number.isFinite(Date.parse(at))?new Date(at).toLocaleString():null;
    holder.title=count==null?'Holder count unavailable':`${data.holderCountStale?'Last known count':'Indexed holder count'}${time?` · ${data.holderCountAsOf?'Source updated':'Checked'} ${time}`:''}`;
    let note=document.querySelector('#coin-holder-freshness');
    if(!note){note=document.createElement('small');note.id='coin-holder-freshness';holder.after(note);}
    note.textContent=data.holderCountStale&&count!=null?'Last known count':time?`${data.holderCountAsOf?'As of':'Checked'} ${new Date(at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'';
    note.hidden=!note.textContent;
  }
}
