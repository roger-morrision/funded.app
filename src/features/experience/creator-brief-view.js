import { apiRequest } from '../../../client.js';
import { el, panel, button, utc, reportContextLink, array } from './view-utils.js';
import { productEvent } from '../../../product-events.js';
const fields = [['purpose','What the project does'],['rewards','How rewards work'],['delivered','What has shipped'],['nextMilestone','Next milestone']];
export function mountCreatorBrief(page, creator) {
  if (!creator.brief) return;
  const root = panel('creator-brief','Creator brief','Creator statement. Identity verification does not verify the claims in this brief.');
  for (const [key,label] of fields) root.append(el('h3',label),el('p',creator.brief[key] || 'No update published.'));
  root.append(el('small',`Version ${creator.brief.version} · ${utc(creator.brief.publishedAt)}`));
  page.querySelector('.support-metrics')?.before(root);
}
export function mountCreatorBriefSettings(page, managed) {
  const root = panel('creator-brief-settings','Publish your creator brief','Publishing creates a dated version. Original launch metadata and signed fee policies are unchanged.');
  const form = el('form');
  for (const [key,label] of fields) {
    const wrap = el('label',label), input = el('textarea'); input.name=key;input.maxLength=280;input.rows=3;input.value=managed.profile?.brief?.[key] || '';wrap.append(input);form.append(wrap);
  }
  const submit = el('button','Review and publish brief');submit.type='submit';submit.disabled=managed.content?.briefs !== true;
  const status=el('p',submit.disabled ? 'Brief publishing requires the matching updated API.' : 'Review all four fields before publishing.');status.setAttribute('role','status');form.append(submit,status);root.append(form);
  page.querySelector('#creator-update-form')?.before(root);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(managed.content?.briefs !== true)return;submit.disabled=true;
    try {
      const body=Object.fromEntries(fields.map(([key])=>[key,form.elements.namedItem(key).value]));
      const result=await apiRequest('/api/creator-support/brief',{method:'POST',headers:{'x-creator-csrf':managed.csrf},body});
      if(!result.available || !Number.isSafeInteger(result.data?.version))throw new Error('Publication could not be verified. Refresh creator settings before trying again.');
      status.textContent=`Brief version ${result.data.version} published · ${utc(result.data.publishedAt)}`;
      productEvent('creator_brief_published');
    }catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
  });
  const routine=el('details');routine.append(el('summary','Creator communication routine'));
  const update=page.querySelector('#creator-update-text');
  for(const [label,text] of [['Launch day','Launch recap: what the project does, the signed fee split, mint address and where to verify receipts.'],['Progress update','Progress update: what shipped, what changed, known issues and the next milestone.'],['Rewards recap','Rewards recap: link verified recipient receipts, explain pending funding and the next eligibility cutoff.']])routine.append(button(`Draft ${label.toLowerCase()} update`,()=>{if(!update)return;update.value=text;update.dispatchEvent(new Event('input',{bubbles:true}));update.focus();}));
  routine.append(el('p','Templates fill a draft only. Check every claim and linked receipt before using the existing publish or schedule controls. A weekly progress update and a receipt recap help returning users.'));root.append(routine);
}
export function mountCreatorContentControls(page, creator) {
  const key=`funded.hidden-creator-updates.${creator.id}.v1`;
  let hidden;try{hidden=new Set(array(JSON.parse(localStorage.getItem(key) || '[]')).filter(id=>/^[a-f0-9]{24}$/.test(id)).slice(-100));}catch{hidden=new Set();}
  const root=page.querySelector('.creator-updates');if(!root)return;
  for (const article of root.querySelectorAll('article')) {
    const id=article.querySelector('[data-update-card]')?.dataset.updateCard;if(!id)continue;
    article.prepend(el('small','Creator statement · verified account, claims not independently verified'));
    const content=[...article.children];
    const control=button(hidden.has(id)?'Show hidden update':'Hide this update',()=>{
      try{if(hidden.has(id))hidden.delete(id);else hidden.add(id);localStorage.setItem(key,JSON.stringify([...hidden].slice(-100)));sync();window.dispatchEvent(new Event('funded:content-preferences'));}
      catch{control.textContent='Hiding could not be saved';}
    });
    const sync=()=>{const hide=hidden.has(id);for(const node of content)node.hidden=hide;control.textContent=hide?'Show hidden update':'Hide this update';};
    article.append(control,reportContextLink('Report an issue'));sync();
  }
}
