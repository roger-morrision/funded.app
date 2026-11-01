import {assertBannerReady} from '../../../launch-banner.js';

const fields=[['token-description','Description',280],['token-roadmap','Roadmap',420],['token-banner','Banner']];
const layouts=new WeakMap();

export function promotionContentState(policy,{document=globalThis.document,includeBanner=true,includeRoadmap=true}={}){
  if(!policy?.requiresBurn)return{valid:true,required:false};
  for(const[id,label,max]of fields.slice(0,2)){
    if(id==='token-roadmap'&&!includeRoadmap)continue;
    const value=document.querySelector('#'+id)?.value?.trim()||'';
    if(!value)return{valid:false,required:true,field:'#'+id,message:`Add a token ${label.toLowerCase()} for the promotion package.`};
    if(value.length>max)return{valid:false,required:true,field:'#'+id,message:`Keep the ${label.toLowerCase()} within ${max} characters.`};
  }
  if(includeBanner){try{assertBannerReady({required:true});}catch(error){return{valid:false,required:true,field:'#token-banner',message:error.message};}}
  return{valid:true,required:true};
}

function arrangePromotionFields(root,paid,upload,document){
  const container=root.querySelector('.promotion-content-fields');
  if(paid&&!layouts.has(root)){
    const nodes=[document.getElementById('token-description')?.closest('label'),document.querySelector('.enhanced-token-page')].filter(Boolean);
    layouts.set(root,nodes.map(node=>{
      const home=document.createComment('Optional content position'),disclosure=node.closest('details');
      node.before(home);
      return{node,home,disclosure,hidden:Boolean(disclosure?.hidden)};
    }));
  }
  for(const slot of layouts.get(root)||[]){
    if(paid){
      if(slot.node.parentElement!==container)container.insertBefore(slot.node,upload);
      if(slot.disclosure)slot.disclosure.hidden=true;
    }else{
      if(slot.node.previousSibling!==slot.home)slot.home.after(slot.node);
      if(slot.disclosure)slot.disclosure.hidden=slot.hidden;
    }
  }
}

export function renderPromotionRequirements(policy,{document=globalThis.document}={}){
  const paid=Boolean(policy.requiresBurn),upload=document.querySelector('#launch-banner-upload');if(!upload)return;
  const storySummary=document.querySelector('#launch-story-options > summary');
  if(storySummary)storySummary.textContent=paid?'Story and roadmap · roadmap required for promotion':'Optional story and roadmap';
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
    root.setAttribute('aria-labelledby','launch-promotion-content-title');
    root.innerHTML='<h3 id="launch-promotion-content-title">Promotion content</h3><p data-promotion-content-status role="status"></p><div class="promotion-content-fields"></div>';
    upload.before(root);root.lastElementChild.append(upload);
  }
  arrangePromotionFields(root,paid,upload,document);
  root.hidden=!paid;if(!paid)return;
  const state=promotionContentState(policy,{document});root.dataset.complete=String(state.valid);
  root.querySelector('[data-promotion-content-status]').textContent=state.valid?`${policy.label} content is ready.`:state.message;
}
