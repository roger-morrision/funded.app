import {assertBannerReady,getPreparedBanner} from '../../../launch-banner.js';

const fields=[['token-description','Description',280],['token-roadmap','Roadmap',420],['token-banner','Banner']];

export function promotionContentState(policy,{document=globalThis.document,includeBanner=true}={}){
  if(!policy?.requiresBurn)return{valid:true,required:false};
  for(const[id,label,max]of fields.slice(0,2)){
    const value=document.querySelector('#'+id)?.value?.trim()||'';
    if(!value)return{valid:false,required:true,field:'#'+id,message:`Add a token ${label.toLowerCase()} for the promotion package.`};
    if(value.length>max)return{valid:false,required:true,field:'#'+id,message:`Keep the ${label.toLowerCase()} within ${max} characters.`};
  }
  if(includeBanner){try{assertBannerReady({required:true});}catch(error){return{valid:false,required:true,field:'#token-banner',message:error.message};}}
  return{valid:true,required:true};
}

export function focusPromotionField(id,document=globalThis.document){
  const input=document.getElementById(id);if(!input)return;
  const step=input.closest('[data-launch-step]')?.dataset.launchStep;
  if(step)document.querySelector(`[data-launch-step-target="${step}"]`)?.click();
  for(let details=input.closest('details');details;details=details.parentElement?.closest('details'))details.open=true;
  input.scrollIntoView({block:'center',behavior:'instant'});input.focus({preventScroll:true});
}

export function renderPromotionRequirements(policy,{document=globalThis.document}={}){
  const paid=Boolean(policy.requiresBurn),upload=document.querySelector('#launch-banner-upload');if(!upload)return;
  for(const[id]of fields){
    const input=document.getElementById(id);if(!input)continue;
    input.required=paid;input.setAttribute('aria-required',String(paid));
    if(!paid)input.removeAttribute('aria-invalid');
    const label=input.closest('label')||document.querySelector(`label[for="${id}"]`);
    let badge=label?.querySelector('.optional');
    if(!badge&&label){badge=document.createElement('span');badge.className='optional';label.insertBefore(badge,input.parentElement===label?input:null);}
    if(badge){badge.textContent=paid?'required for promotion':'optional';badge.classList.toggle('promotion-required',paid);}
  }
  let root=document.getElementById('launch-promotion-requirements');
  if(!root){
    root=document.createElement('section');root.id='launch-promotion-requirements';root.className='promotion-content-requirements';
    root.innerHTML='<p data-promotion-content-status role="status"></p><div class="promotion-content-links"></div>';
    for(const[id]of fields){const button=document.createElement('button');button.type='button';button.dataset.promotionField=id;button.addEventListener('click',()=>focusPromotionField(id,document));root.lastElementChild.append(button);}
    upload.after(root);
  }
  root.hidden=!paid;if(!paid)return;
  const state=promotionContentState(policy,{document});root.dataset.complete=String(state.valid);
  root.querySelector('[data-promotion-content-status]').textContent=state.valid?`${policy.label} content is ready.`:`${policy.label} requires a banner, description and roadmap. ${state.message}`;
  for(const[id,label,max]of fields){
    let ready=id==='token-banner'?false:Boolean(document.getElementById(id)?.value.trim())&&document.getElementById(id).value.trim().length<=max;
    if(id==='token-banner'){try{assertBannerReady({required:true});ready=Boolean(getPreparedBanner());}catch{}}
    const button=root.querySelector(`[data-promotion-field="${id}"]`);button.textContent=ready?`${label} added`:`Add ${label.toLowerCase()}`;button.dataset.ready=String(ready);
  }
}
