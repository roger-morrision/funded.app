import { panel, el, button } from './view-utils.js';
const KEY='funded.trade-preferences.v1';
export function normalizeTradePreferences(value={}) {
  const cap=Number(value.slippageCap);
  return {slippageCap:Number.isFinite(cap)&&cap>=.1&&cap<=10?cap:10,
    maximumNetworkSol:typeof value.maximumNetworkSol==='string'&&/^(?:0|[1-9]\d?)(?:\.\d{1,9})?$/.test(value.maximumNetworkSol)&&Number(value.maximumNetworkSol)>0?value.maximumNetworkSol:''};
}
export function readTradePreferences(storage=globalThis.localStorage){if(!storage)return normalizeTradePreferences();try{return normalizeTradePreferences(JSON.parse(storage.getItem(KEY)||'{}'));}catch{return {...normalizeTradePreferences(),unavailable:true};}}
export function assertTradeLimits({slippagePercent,networkFeeLamports=null},prefs=readTradePreferences(),{checkNetwork=false}={}){
  if(prefs.unavailable)throw new Error('Saved trade limits are unavailable. Restore browser storage before signing.');
  if(!Number.isFinite(slippagePercent)||slippagePercent>prefs.slippageCap)throw new Error(`Slippage exceeds your saved ${prefs.slippageCap}% cap. Change the trade or review your preferences.`);
  if(checkNetwork&&prefs.maximumNetworkSol){
    if(!/^\d+$/.test(String(networkFeeLamports)))throw new Error('Network fee is unavailable. Your saved network fee cap prevents signing until it can be checked.');
    const [whole,part='']=prefs.maximumNetworkSol.split('.'),cap=BigInt(whole)*1000000000n+BigInt(part.padEnd(9,'0'));
    if(BigInt(networkFeeLamports)>cap)throw new Error('The prepared transaction exceeds your saved network fee cap. Review preferences or try again later.');
  }
}
export function initializeTradePreferences(app){
  const parent=document.querySelector('#profile');if(!parent)return;
  const explanation='Applied to quote review and checked again before submission on this device. The network cap covers the prepared transaction fee estimate; account rent and trade spending are additional. The wallet shows final costs.';
  const root=panel('trade-preferences','Trade limits','Limits apply on this device and are checked before signing.');
  const form=el('form'),prefs=readTradePreferences(),slippage=el('input'),network=el('input');slippage.type='number';slippage.min='.1';slippage.max='10';slippage.step='.1';slippage.required=true;slippage.value=prefs.slippageCap;network.inputMode='decimal';network.value=prefs.maximumNetworkSol;network.maxLength=12;
  const a=el('label','Maximum slippage (%)'),b=el('label','Estimated network fee cap (SOL)');a.append(slippage);b.append(network);const status=el('p');status.setAttribute('role','status');
  const fields=el('div',null,'settings-field-grid');fields.append(a,b);
  const help=el('details',null,'settings-help');help.append(el('summary','How trade limits work'),el('p',explanation),el('p','Transactions use the configured Pump route. Protected routing is unavailable here; no MEV protection guarantee is made.'));
  form.append(fields,el('p','Leave the fee cap blank to turn it off. Trade spending and account rent are separate.','field-help'),button('Save trade limits',()=>{
    if(!form.reportValidity())return;
    const input={slippageCap:Number(slippage.value),maximumNetworkSol:network.value.trim()},next=normalizeTradePreferences(input);
    if(next.maximumNetworkSol!==input.maximumNetworkSol){status.textContent='Enter a positive SOL fee limit below 100 with up to nine decimals, or leave blank.';return;}
    try{localStorage.setItem(KEY,JSON.stringify(next));app.invalidateTradePreview();document.querySelector('#trade-review-dialog')?.close();status.textContent='Limits saved. Any open quote must be reviewed again.';}catch{status.textContent='Limits could not be saved. Check browser storage.';}
  }),help,status);form.addEventListener('submit',event=>event.preventDefault());root.append(form);parent.append(root);
}
