import { mountMobileFilterDrawer } from '../shared/mobile-filter-drawer.js';
import { mountFilterChips } from '../shared/filter-toolbar.js';
export function mountRewardHistoryControls(root, onChange) {
  const toolbar = document.createElement('div'); toolbar.className = 'history-refine';
  toolbar.innerHTML = '<label>Search activity<input type="search" data-history-query placeholder="Token, wallet or transaction" autocomplete="off"></label><label>From (UTC)<input type="date" data-history-from></label><label>To (UTC)<input type="date" data-history-to></label><label>Sort<select data-history-sort><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label><button type="button" data-history-reset>Clear filters</button>';
  root.querySelector('.financial-toolbar').after(toolbar);
  const controls = Object.fromEntries(['query','from','to','sort'].map(key => [key, toolbar.querySelector(`[data-history-${key}]`)]));
  const error = document.createElement('p'); error.className = 'history-range-error';error.id='reward-history-range-error'; error.setAttribute('role', 'status'); toolbar.after(error);
  for(const key of ['from','to'])controls[key].setAttribute('aria-describedby',error.id);
  const status=root.querySelector('[data-flow-filter]');
  const reset = () => { for (const [key, control] of Object.entries(controls)) control.value = key === 'sort' ? 'newest' : '';status.value='all'; onChange(); };
  const syncChips = mountFilterChips(toolbar, [
    {control:controls.query,label:'Search'}, {control:controls.from,label:'From'}, {control:controls.to,label:'To'},
    {control:controls.sort,label:'Sort',empty:'newest'},
    {control:status,label:'Status',empty:'all'},
  ], {reset});
  toolbar.addEventListener('input', event => { if (!event.isComposing) onChange(); });
  toolbar.addEventListener('compositionend', onChange);
  toolbar.addEventListener('change', onChange);
  toolbar.querySelector('[data-history-reset]').addEventListener('click', reset);
  const note=document.createElement('small');note.textContent='Date filters use UTC and exclude actions without a recorded date.';toolbar.append(note);
  const chips=toolbar.nextElementSibling;
  const drawer=mountMobileFilterDrawer(toolbar,{title:'Reward activity filters',items:[controls.from.closest('label'),controls.to.closest('label'),controls.sort.closest('label'),toolbar.querySelector('[data-history-reset]'),note,error],fields:[{control:controls.from},{control:controls.to},{control:controls.sort,empty:'newest'},{control:status,empty:'all'}]});
  const sync=()=>{syncChips();drawer.sync();};
  return { reset, sync, setVisible(visible) {drawer.setVisible(visible);toolbar.hidden=!visible;error.hidden=!visible||!error.textContent;chips.hidden=!visible||!chips.childElementCount;}, values() {
    const values = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]));
    const invalid = Boolean(values.from && values.to && values.from > values.to);
    error.hidden = !invalid; error.textContent = invalid ? 'End date must be on or after start date.' : '';
    for (const key of ['from','to']) controls[key].setAttribute('aria-invalid', String(invalid));
    return values;
  } };
}
