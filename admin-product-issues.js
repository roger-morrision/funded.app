export function initAdminProductIssues({api,post,show}){
  const parent=document.querySelector('#workspace');if(!parent)return;
  const root=document.createElement('section');root.className='panel';const heading=document.createElement('h2');heading.textContent='Product issue review';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Load reported issues';const list=document.createElement('div');root.append(heading,refresh,list);parent.append(root);
  refresh.addEventListener('click',async()=>{refresh.disabled=true;try{
    const result=await api('/api/admin/product-issues');list.replaceChildren();
    for(const row of result.reports||[]){const item=document.createElement('article'),title=document.createElement('h3'),text=document.createElement('p'),context=document.createElement('pre'),status=document.createElement('select'),note=document.createElement('textarea'),save=document.createElement('button');
      title.textContent=`${row.category} · ${row.id} · ${row.createdAt}`;text.textContent=row.description;context.textContent=JSON.stringify(row.context,null,2);status.setAttribute('aria-label',`Report status ${row.id}`);note.setAttribute('aria-label',`Public reviewer note ${row.id}`);note.maxLength=500;note.value=row.note||'';
      for(const value of ['received','investigating','fixed','needs-information']){const option=document.createElement('option');option.value=value;option.textContent=value;status.append(option);}status.value=row.status;
      save.type='button';save.textContent='Save reviewed status';save.addEventListener('click',async()=>{save.disabled=true;try{await post(`/api/admin/product-issues/${row.id}`,{status:status.value,note:note.value});show('Report status saved. The reporter can check this note.');}catch(error){show(error.message,true);}finally{save.disabled=false;}});
      item.append(title,text,context,status,note,save);list.append(item);
    }if(!list.children.length)list.textContent='No reports in the current coverage.';
  }catch(error){show(error.message,true);}finally{refresh.disabled=false;}});
}
