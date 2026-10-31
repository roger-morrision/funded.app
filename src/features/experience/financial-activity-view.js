import { el, link, utc } from './view-utils.js';
import { receiptUrl } from './receipt-inspector.js';
import { icon } from '../../../ui-icons.js';

export function financialAmountParts(value) {
  const match = /^(\d+)(\.\d+)? (SOL|\$FUNDED base units)$/.exec(String(value));
  if (!match) return { value:String(value), unit:'' };
  // Keep integer and fractional digits exact; base units can exceed Number precision.
  return { value:match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (match[2] || ''), unit:match[3] };
}

export function financialRecord(row, expanded) {
  const item=el('article',null,'financial-record flow-activity-row');item.dataset.stage=row.stage;
  const main=el('div',null,'financial-record-main'),mark=el('span',null,'financial-record-icon');
  mark.setAttribute('aria-hidden','true');mark.innerHTML=icon(row.title.includes('burn')?'burn':'rewards');
  const copy=el('div',null,'financial-record-copy'),title=el('h3',row.title);
  const meta=el('div',null,'financial-record-meta');
  if(row.at)meta.append(el('time',utc(row.at)));
  const token=link(`${row.mint.slice(0,6)}…${row.mint.slice(-4)}`,`/token/${row.mint}`);token.title=row.mint;token.setAttribute('aria-label',`View token ${row.mint}`);meta.append(token);
  const action=link(row.action||'Inspect exact receipt',row.href);action.className='financial-record-action';
  if(row.signature){
    if(row.receiptView==='explorer'){action.href=`https://explorer.solana.com/tx/${row.signature}?cluster=devnet`;action.textContent='Inspect on-chain policy burn ↗';action.target='_blank';action.rel='noopener noreferrer';}
    else{action.href=receiptUrl(row.signature,row.mint,row.wallet);action.textContent='Inspect exact receipt';}
  }
  copy.append(title,meta,action);
  const value=el('div',null,'financial-record-value'),amount=financialAmountParts(row.amount);
  const exact=el('strong',amount.value);exact.append(el('span',amount.unit?' '+amount.unit:'','financial-record-unit'));
  value.append(exact,el('span',row.stage,'flow-stage'));main.append(mark,copy,value);
  const details=el('details',null,'financial-record-details');details.open=expanded.has(row.id);
  details.append(el('summary','Evidence & addresses'),el('p',row.detail));
  const fields=el('dl');
  for(const [label,text]of [['Token mint',row.mint],['Wallet',row.wallet],['Recorded time',utc(row.at)]]){
    if(!text)continue;fields.append(el('dt',label),el('dd',text));
  }
  details.append(fields);details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open)expanded.add(row.id);else expanded.delete(row.id);});
  item.append(main,details);return item;
}
