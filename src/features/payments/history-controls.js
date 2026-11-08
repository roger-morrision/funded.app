import { mountMobileFilterDrawer } from '../shared/mobile-filter-drawer.js';
import { mountFilterChips } from '../shared/filter-toolbar.js';
// Bind once at the existing History startup position; rendering owns no requests.
export function initializePaymentHistoryControls({ document, renderHistory, refreshHistory }) {
  const heading=document.querySelector('#payment-list')?.closest('.panel')?.querySelector('.panel-heading');
  if(heading&&refreshHistory&&!document.querySelector('#payment-history-refresh')) {
    const refresh=document.createElement('button');refresh.id='payment-history-refresh';
    refresh.type='button';refresh.className='secondary-button';refresh.textContent='Refresh';
    refresh.onclick=async()=>{refresh.disabled=true;refresh.textContent='Checking…';
      try{await refreshHistory();}finally{refresh.disabled=false;renderHistory();}};
    heading.append(refresh);
  }
  const toolbar=document.querySelector('#payment-history-filters');
  if(toolbar&&!document.querySelector('#payment-history-sort')) {
    const label=document.createElement('label');label.textContent='Sort';
    const select=document.createElement('select');select.id='payment-history-sort';
    for(const [value,text] of [['newest','Newest first'],['oldest','Oldest first']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
    label.append(select);toolbar.querySelector('#payment-history-clear')?.before(label);
  }
  const syncChips=mountFilterChips(toolbar,[['search','Search',''],['type','Type','all'],['from','From',''],['to','To',''],['sort','Sort','newest']]
    .map(([id,label,empty])=>({control:document.querySelector(`#payment-history-${id}`),label,empty})),{reset:()=>document.querySelector('#payment-history-clear')?.click()});
  const drawer=mountMobileFilterDrawer(toolbar,{title:'Payment history filters',items:['type','from','to','sort'].map(id=>document.querySelector('#payment-history-'+id)?.closest('label')).concat(document.querySelector('#payment-history-clear')),fields:['type','from','to','sort'].map(id=>({control:document.querySelector('#payment-history-'+id),empty:id==='type'?'all':id==='sort'?'newest':''}))});
  const sync=()=>{syncChips();drawer.sync();};
  document.querySelector('#payment-history-filters')?.addEventListener('change', event => {
    // Input already commits search edits. A blur change must not replace the
    // receipt row while a visitor is clicking its native disclosure or links.
    if (event.target.id !== 'payment-history-search') renderHistory();
  });
  const search = document.querySelector('#payment-history-search');
  search?.addEventListener('input', event => {
    if (!event.isComposing) renderHistory();
  });
  search?.addEventListener('compositionend', () => renderHistory());
  document.querySelector('#payment-history-clear')?.addEventListener('click', () => {
    for (const selector of ['#payment-history-search', '#payment-history-type', '#payment-history-from', '#payment-history-to', '#payment-history-sort']) {
      const input = document.querySelector(selector);
      if (input) input.value = selector === '#payment-history-type' ? 'all' : selector === '#payment-history-sort' ? 'newest' : '';
    }
    renderHistory();sync();
  });
}
