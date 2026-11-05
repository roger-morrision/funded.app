import { panel, el, link, button, array, utc } from './view-utils.js';

const value = number => number == null ? 'Unavailable' : Number(number).toLocaleString();
const duration = seconds => seconds == null ? 'Unavailable' : seconds < 60 ? `${seconds}s` : `${Math.floor(Math.round(seconds)/60)}m ${Math.round(seconds)%60}s`;
function table(title, columns, rows) {
  const scroll=el('div',null,'operations-table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',title);
  const node=el('table'),head=el('thead'),heading=el('tr'),body=el('tbody');node.append(el('caption',title));
  for(const column of columns){const th=el('th',column);th.scope='col';heading.append(th);}head.append(heading);
  for(const cells of rows){const row=el('tr');cells.forEach((cell,index)=>{const td=el(index===0?'th':'td');if(index===0)td.scope='row';td.append(typeof cell==='string'?document.createTextNode(cell):cell);row.append(td);});body.append(row);}
  node.append(head,body);scroll.append(node);return scroll;
}

export function initializeOperationsView(app) {
  const parent=document.querySelector('#financial-center');if(!parent)return;
  const details=el('details');details.append(el('summary','Payout speed & system status'));
  const root=panel('financial-engine','Payout dashboard');details.append(root);parent.append(details);
  const header=el('header'),heading=root.firstElementChild,refreshButton=button('Refresh data',()=>void refresh());
  header.append(heading,refreshButton);const content=el('div',null,'operations-dashboard');root.replaceChildren(header,content);
  let busy=false;
  async function refresh() {
    if(busy||!details.open)return;busy=true;refreshButton.setAttribute('aria-disabled','true');content.setAttribute('aria-busy','true');
    if(!content.childElementCount)content.append(el('p','Checking payout records…'));
    try {
      const result=await app.apiRequest('/api/financial/operations',{signal:AbortSignal.timeout(18000)});
      const data=result.available&&result.data?.cluster==='devnet'&&result.data.evidence==='recorded-finalized-v3'?result.data:null;
      if(!data)throw Error('Unavailable');
      const stats=el('dl',null,'operations-stats');
      for(const [label,count] of [['Completed buybacks',data.completedRecordedOperations],['Pending buybacks',data.pendingBuybackOperations],['Failed operations',data.failedRecordedOperations]]){
        const card=el('div');card.append(el('dt',label),el('dd',value(count)));stats.append(card);
      }
      const status=el('dl',null,'operations-status');
      for(const [label,text] of [['Last verified delivery',utc(data.lastVerifiedDeliveryAt)],['Retry-attempt count',value(data.retryAttempts)],['Oldest pending operation',duration(data.oldestPendingSeconds)]]){
        const row=el('div');row.append(el('dt',label),el('dd',text));status.append(row);
      }
      const timings=[['Collection → settlement','collectionToSettlement'],['Funding → X payout','fundedToVerifiedXPayment'],['Funding → holder payout','fundedToVerifiedHolderPayment'],['Funding → bonus payout','fundedToVerifiedBonusPayment']].map(([label,key])=>{
        const sample=data.timing?.[key];return [label,duration(sample?.medianSeconds),duration(sample?.p95Seconds),value(sample?.samples)];
      });
      const timingTable=table('Payout timing',['Stage','Median','95th percentile','Samples'],timings);
      const creators=array(data.creators).slice(0,10).map(creator=>{
        const wallet=String(creator.wallet||''),name=link(`${wallet.slice(0,6)}…${wallet.slice(-4)}`,`/wallet/${encodeURIComponent(wallet)}`);name.title=wallet;name.setAttribute('aria-label',`View wallet ${wallet}`);
        const badges=el('div',null,'operations-badges');for(const badge of array(creator.badges))badges.append(el('span',badge));
        if(!badges.childElementCount)badges.textContent='No recorded badge';
        return [name,value(creator.verifiedPaymentReceipts),value(creator.returningRecipients),badges];
      });
      const creatorTable=creators.length?table('Creator delivery',['Wallet','Payment receipts','Returning paid wallets','Recorded status'],creators):el('p','No creator delivery records are available.','operations-empty');
      const coverage=el('details',null,'operations-coverage');coverage.append(el('summary','Data coverage & methodology'));
      for(const text of [data.coverage,data.timing?.coverage,data.retentionCoverage,`Vault reconciliation: ${data.reconciliation?.status||'unavailable'}. ${data.reconciliation?.reason||'Complete opening, inflow, outflow and closing evidence is unavailable.'}`])if(text)coverage.append(el('p',text));
      content.replaceChildren(stats,status,timingTable,creatorTable,coverage,el('p',`Recorded data updated ${utc(data.generatedAt)}. Current vault balances are available in Buybacks.`,'operations-updated'));
    } catch {
      content.replaceChildren(el('h3','Payout status unavailable'),el('p','These records could not be loaded. Refresh to try again. Existing receipts and financial policies are unchanged.'));
    } finally {busy=false;refreshButton.removeAttribute('aria-disabled');content.removeAttribute('aria-busy');}
  }
  details.addEventListener('toggle',()=>void refresh());
}
