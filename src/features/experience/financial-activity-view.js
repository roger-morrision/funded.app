import { el, link, utc } from './view-utils.js';
import { receiptUrl } from './receipt-inspector.js';
import { icon } from '../../../ui-icons.js';

export function financialAmountParts(value) {
  const match = /^(\d+)(\.\d+)? (SOL|\$FUNDED base units)$/.exec(String(value));
  if (!match) return { value:String(value), unit:'' };
  // Keep integer and fractional digits exact; base units can exceed Number precision.
  return { value:match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (match[2] || ''), unit:match[3] };
}

const recordViews = new WeakMap();
const text = (node,value) => { const next=String(value ?? '');if(node.textContent!==next)node.textContent=next; };

export function financialRecord(row, expanded, existing) {
  if(existing&&recordViews.has(existing)){updateRecord(existing,row);return existing;}
  const item=el('article',null,'financial-record flow-activity-row');item.dataset.recordId=row.id;
  const main=el('div',null,'financial-record-main'),mark=el('span',null,'financial-record-icon');
  mark.setAttribute('aria-hidden','true');
  const copy=el('div',null,'financial-record-copy'),title=el('h3');
  const meta=el('div',null,'financial-record-meta');
  const time=el('time'),token=link('','');meta.append(time,token);
  const action=link('','');action.className='financial-record-action';
  copy.append(title,meta,action);
  const value=el('div',null,'financial-record-value'),exact=el('strong'),amount=document.createTextNode(''),unit=el('span','','financial-record-unit'),stage=el('span','','flow-stage');
  exact.append(amount,unit);value.append(exact,stage);main.append(mark,copy,value);
  const details=el('details',null,'financial-record-details');details.open=expanded.has(row.id);
  const detail=el('p');details.append(el('summary','Evidence & addresses'),detail);
  const fields=el('dl'),values=['Token mint','Wallet','Recorded time'].map(label=>{const term=el('dt',label),value=el('dd');fields.append(term,value);return{term,value};});
  details.append(fields);details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open)expanded.add(row.id);else expanded.delete(row.id);});
  item.append(main,details);recordViews.set(item,{mark,title,time,token,action,amount,unit,stage,detail,values});updateRecord(item,row);return item;
}

function updateRecord(item,row){
  const view=recordViews.get(item);item.dataset.stage=row.stage;
  const mark=row.title.includes('burn')?'burn':'rewards';if(view.mark.dataset.icon!==mark){view.mark.innerHTML=icon(mark);view.mark.dataset.icon=mark;}
  text(view.title,row.title);view.time.hidden=!row.at;text(view.time,utc(row.at));
  text(view.token,`${row.mint.slice(0,6)}…${row.mint.slice(-4)}`);view.token.href=`/token/${row.mint}`;view.token.title=row.mint;view.token.setAttribute('aria-label',`View token ${row.mint}`);
  const explorer=row.signature&&row.receiptView==='explorer';
  view.action.href=explorer?`https://explorer.solana.com/tx/${row.signature}?cluster=devnet`:row.signature?receiptUrl(row.signature,row.mint,row.wallet):row.href;
  text(view.action,explorer?'Inspect on-chain policy burn ↗':row.signature?'Inspect exact receipt':row.action||'Inspect exact receipt');
  if(explorer){view.action.target='_blank';view.action.rel='noopener noreferrer';}else{view.action.removeAttribute('target');view.action.removeAttribute('rel');}
  const amount=financialAmountParts(row.amount);if(view.amount.nodeValue!==amount.value)view.amount.nodeValue=amount.value;text(view.unit,amount.unit?' '+amount.unit:'');text(view.stage,row.stage);text(view.detail,row.detail);
  [row.mint,row.wallet,utc(row.at)].forEach((value,index)=>{const field=view.values[index];field.term.hidden=field.value.hidden=!value;text(field.value,value);});
}

// Preserve the actual controls while polling; never substitute another receipt.
export function renderFinancialRecords(list,rows,expanded,fallback){
  const document=list.ownerDocument,active=document.activeElement,owned=list.contains(active)&&active.getClientRects().length;
  const owner=owned?active.closest('[data-record-id]'):null,previousIndex=owner?[...list.children].indexOf(owner):-1;
  let cancelled=false,moved=false;const intervention=event=>{if(event.target!==active)cancelled=true;};
  if(owned)document.addEventListener('focusin',intervention,true);
  try{
    const previous=new Map([...list.children].filter(item=>item.dataset.recordId).map(item=>[item.dataset.recordId,item]));
    for(const child of[...list.children])if(!child.dataset.recordId)child.remove();
    let cursor=list.firstElementChild;
    for(const row of rows){
      const item=financialRecord(row,expanded,previous.get(row.id));previous.delete(row.id);
      if(item!==cursor){
        if(owned&&item.contains(active))moved=true;
        if(item.parentElement===list&&typeof list.moveBefore==='function')list.moveBefore(item,cursor);else list.insertBefore(item,cursor);
      }
      cursor=item.nextElementSibling;
    }
    for(const item of previous.values())item.remove();
    if(owner&&[...list.children].indexOf(owner)!==previousIndex)moved=true;
    if(owned&&!cancelled&&(document.activeElement===active||document.activeElement===document.body)){
      const retained=list.contains(active)&&active.getClientRects().length,target=retained?active:fallback;
      if(target?.getClientRects().length){
        if(!retained)target.tabIndex=-1;
        if(document.activeElement!==target)target.focus({preventScroll:true});
        if(moved||!retained)target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      }
    }
  }finally{if(owned)document.removeEventListener('focusin',intervention,true);}
}
