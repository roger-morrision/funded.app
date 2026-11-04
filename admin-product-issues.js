export function initAdminProductIssues({api,post,show}){
  const parent=document.querySelector('#workspace');if(!parent)return;
  const root=document.createElement('section');root.className='panel';const heading=document.createElement('h2');heading.textContent='Product issue review';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Load reported issues';const list=document.createElement('div');root.append(heading,refresh,list);parent.append(root);
  let generation=0,loading=false,saving=false;
  const current=(epoch,request)=>!parent.hidden&&parent.dataset.sessionEpoch===epoch&&request===generation;
  function sync(){
    refresh.disabled=parent.hidden||loading||saving;
    for(const field of list.querySelectorAll('select,textarea,button'))field.disabled=loading||saving||field.closest('article').dataset.stale==='true';
  }
  refresh.addEventListener('click',async()=>{
    if(parent.hidden||loading||saving)return;
    const epoch=parent.dataset.sessionEpoch,request=++generation;loading=true;list.replaceChildren();sync();
    try{
      const result=await api('/api/admin/product-issues');if(!current(epoch,request))return;
      for(const row of result.reports||[]){
        const item=document.createElement('article'),title=document.createElement('h3'),text=document.createElement('p'),context=document.createElement('pre'),status=document.createElement('select'),note=document.createElement('textarea'),save=document.createElement('button');
        title.textContent=`${row.category} · ${row.id} · ${row.createdAt}`;text.textContent=row.description;context.textContent=JSON.stringify(row.context,null,2);
        context.style.whiteSpace='pre-wrap';context.style.overflowWrap='anywhere';
        status.setAttribute('aria-label',`Report status ${row.id}`);note.setAttribute('aria-label',`Public reviewer note ${row.id}`);note.maxLength=500;note.value=row.note||'';
        for(const value of ['received','investigating','fixed','needs-information']){const option=document.createElement('option');option.value=value;option.textContent=value;status.append(option);}status.value=row.status;
        save.type='button';save.textContent='Save reviewed status';save.addEventListener('click',async()=>{
          if(!current(epoch,request)||loading||saving||item.dataset.stale==='true')return;
          const input={status:status.value,note:note.value,expectedUpdatedAt:row.updatedAt};saving=true;sync();
          try{
            const result=await post(`/api/admin/product-issues/${row.id}`,input);if(!current(epoch,request))return;
            if(result.id!==row.id||result.status!==input.status||result.note!==input.note||!Number.isFinite(Date.parse(result.updatedAt)))throw Error('Report save is unverified. Reload reported issues before saving again.');
            row.updatedAt=result.updatedAt;show('Report status saved. The reporter can check this note.');
          }catch(error){if(current(epoch,request)){item.dataset.stale='true';save.textContent='Reload issues before saving';show(error.message,true);}}
          finally{if(current(epoch,request)){saving=false;sync();}}
        });
        item.append(title,text,context,status,note,save);list.append(item);
      }
      if(!list.children.length)list.textContent='No reports in the current coverage.';
    }catch(error){if(current(epoch,request))show(error.message,true);}
    finally{if(current(epoch,request)){loading=false;sync();}}
  });
  new MutationObserver(()=>{
    if(parent.hidden){generation++;loading=saving=false;list.replaceChildren();}sync();
  }).observe(parent,{attributes:true,attributeFilter:['hidden']});sync();
}
