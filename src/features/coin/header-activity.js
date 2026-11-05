import {formatOnChainNumber} from '../shared/display.js';

export function renderHeaderActivity(market,{document=globalThis.document}={}) {
  const ready=['ready','summary-only'].includes(market?.status)&&['complete','partial'].includes(market.coverage);
  const partial=market?.coverage==='partial';
  for(const [id,raw,integer] of [['coin-strip-volume',market?.volume24hSol,false],['coin-strip-trades',market?.tradeCount,true]]){
    const node=document.getElementById(id);if(!node)continue;
    const value=raw==null?NaN:Number(raw),valid=ready&&Number.isFinite(value)&&value>=0&&(!integer||Number.isSafeInteger(value));
    node.textContent=valid?`${partial?'≥':''}${integer?value.toLocaleString('en-US'):formatOnChainNumber(value,4)}`:market?.status==='loading'?'Checking…':'Unavailable';
    node.title=valid?(partial?'Partial verified 24-hour trade scan; more activity may exist.':'Verified 24-hour trade scan.'):'Waiting for verified market activity.';
  }
}
