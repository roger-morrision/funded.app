import { el, panel, button, link, array, utc, portfolioTools } from './view-utils.js';
import { productEvent } from '../../../product-events.js';
const KEY='funded.launch-plans.v1';
const fields=['token-name','token-symbol','token-description','creator-wallet-share','holder-airdrop-share','x-share','x-recipient'];
export function validateLaunchPlan(value,now=Date.now()) {
  if(!Number.isFinite(value.at)||value.at<=now||value.at>now+90*86400000)throw new Error('Choose a return time in the next 90 days.');
  const draft=Object.fromEntries(fields.map(key=>[key,String(value.draft?.[key]||'').slice(0,key==='token-description'?1000:100)]));
  if(!draft['token-name'].trim()||!draft['token-symbol'].trim())throw new Error('Add a token name and ticker first.');
  return {id:crypto.randomUUID(),at:value.at,createdAt:new Date(now).toISOString(),draft};
}
export function readLaunchPlans(storage=globalThis.localStorage){
  const rows=array(JSON.parse(storage.getItem(KEY)||'[]'));return rows.filter(row=>/^[a-f0-9-]{36}$/.test(row.id||'')&&Number.isFinite(row.at)&&row.draft&&typeof row.draft['token-name']==='string').slice(-20);
}
export function initializeLaunchPlans(app){
  const form=document.querySelector('#launch-form'),parent=document.querySelector('#my-launches');if(!form||!parent)return;
  const root=panel('launch-planner','Plan your launch','Save public draft text and a return reminder on this device. At the planned time, return to review current costs and sign. This does not reserve a mint or schedule a transaction. Images and wallet credentials are never saved here.');
  const label=el('label','Return to review at (local time)'),time=el('input');time.type='datetime-local';label.append(time);
  const status=el('p');status.setAttribute('role','status');root.append(label,button('Save planned draft',()=>{
    try{const rows=readLaunchPlans();if(rows.length>=20)throw new Error('Remove an old plan first (maximum 20).');
      const row=validateLaunchPlan({at:new Date(time.value).getTime(),draft:Object.fromEntries(fields.map(key=>[key,document.getElementById(key)?.value||'']))});
      localStorage.setItem(KEY,JSON.stringify([...rows,row]));status.textContent='Draft saved. Return to this app to review and sign; no launch was submitted.';productEvent('launch_plan_saved');render();
    }catch(error){status.textContent=error.message||'Draft storage unavailable.';}
  }),status);
  form.append(root);
  const plans=panel('launch-control-room','Saved launch drafts','Drafts stay on this device. Saving a plan does not submit a launch; return to review current costs and sign.');portfolioTools(parent).append(plans);
  const list=el('div');plans.append(list);
  function render(){list.replaceChildren();try{const rows=readLaunchPlans().sort((a,b)=>a.at-b.at);
    plans.classList.toggle('is-empty',rows.length===0);
    for(const row of rows){const item=el('article',null,'flow-activity-row');item.append(el('h3',row.draft['token-name']),el('p',`${row.at<=Date.now()?'Awaiting review and signature':'Planned return'} · ${utc(row.at)}`));
      item.append(button('Resume draft',()=>{
        const dirty=fields.some(key=>document.getElementById(key)?.value&&document.getElementById(key).value!==row.draft[key]);
        if(dirty&&!confirm('Replace the current form text and fee split with this saved draft?'))return;
        app.setLaunchMode('custom');for(const key of fields){const input=document.getElementById(key);if(input){input.value=String(row.draft[key]||'').slice(0,key==='token-description'?1000:100);input.dispatchEvent(new Event('input',{bubbles:true}));}}
        app.updateLaunchPolicyControls();app.updateLaunchPreview();location.hash='launch';
      }),button('Delete plan',()=>{try{localStorage.setItem(KEY,JSON.stringify(readLaunchPlans().filter(other=>other.id!==row.id)));render();}catch{status.textContent='Plan could not be deleted.';}}),link('Open launch form','#launch'));list.append(item);
    }if(!rows.length)list.append(el('p','No planned drafts. Save one from the launch form.'));
  }catch{list.append(el('p','Saved plans unavailable. Check browser storage.'));}}
  const terms=el('details',null,'flow-panel');terms.append(el('summary','Final launch terms and payout timing'));const body=el('p');terms.append(body);document.querySelector('#launch-button')?.before(terms);
  function review(){const share=id=>document.getElementById(id)?.value||'0';body.textContent=`Review before signing: ${share('token-name')} ($${share('token-symbol')}). Creator ${share('creator-wallet-share')}%, holders ${share('holder-airdrop-share')}%, X ${share('x-share')}%, protocol 20%. Mint identity and signed fee terms cannot be edited through this planner after launch. Budget is separate from distribution: holder cutoffs, ranked daily bonus windows, funding and recipient eligibility still apply. A cutoff does not promise immediate payment. Current costs appear in the budget and wallet review.`;}
  form.addEventListener('input',review);window.addEventListener('funded:launch-step',review);window.addEventListener('storage',render);window.addEventListener('funded:route-change',render);review();render();
}
