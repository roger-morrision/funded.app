export function mountProjectUpdates(app, document=globalThis.document) {
  const panel=document.querySelector('.coin-profile-updates');
  if(!panel||panel.dataset.updatesMounted)return Boolean(panel);
  panel.dataset.updatesMounted='true';panel.replaceChildren();
  const make=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
  const list=make('div'),status=make('p'),refresh=make('button','Refresh updates'),form=make('form');
  status.setAttribute('role','status');refresh.type='button';refresh.className='text-button';
  const label=make('label','Project update'),input=make('textarea'),submit=make('button','Publish update'),cancel=make('button','Cancel edit');
  input.maxLength=2000;input.rows=4;input.required=true;input.id='project-update-text';label.htmlFor=input.id;
  submit.type='submit';submit.className='primary-button';cancel.type='button';cancel.className='secondary-button';cancel.hidden=true;
  form.append(label,input,submit,cancel);form.hidden=true;panel.append(list,refresh,status,form);
  let mint=null,owner=null,rows=[],generation=0,busy=false,edit=null,requestId=null;
  const owns=()=>owner&&app.connectedWalletAddress===owner&&mint===app.getCoinMintAddress?.();
  const resetDraft=()=>{input.value='';edit=null;requestId=null;cancel.hidden=true;submit.textContent='Publish update';};
  function render(){
    list.replaceChildren();form.hidden=!owns();
    if(!rows.length)list.append(make('strong','No updates yet'));
    for(const row of rows){
      const article=make('article');article.className='project-update';
      const time=make('time',new Date(row.createdAt).toLocaleString());time.dateTime=row.createdAt;
      const content=make('p',row.text);content.className='project-update-text';article.append(time,content);
      if(row.updatedAt)article.append(make('small','Edited '+new Date(row.updatedAt).toLocaleString()));
      if(owns()){
        const button=make('button','Edit update');button.type='button';button.className='text-button';button.disabled=busy;
        button.onclick=()=>{edit=row;requestId=row.id;input.value=row.text;cancel.hidden=false;submit.textContent='Save update';input.focus();};article.append(button);
      }
      list.append(article);
    }
    input.disabled=busy;submit.disabled=busy;cancel.disabled=busy;
  }
  async function load(){
    const current=app.getCoinMintAddress?.();if(!current)return;
    const id=++generation;mint=current;refresh.disabled=true;status.textContent='Loading updates…';
    try{
      const result=await app.apiRequest(`/api/tokens/${encodeURIComponent(current)}/updates`);
      if(id!==generation||current!==app.getCoinMintAddress?.())return;
      if(!result.available||result.data?.mint!==current)throw Error('Project updates unavailable.');
      owner=result.data.creator;rows=result.data.updates||[];status.textContent='';render();
    }catch(error){if(id===generation){owner=null;rows=[];render();status.textContent=error.message;}}
    finally{if(id===generation)refresh.disabled=false;}
  }
  refresh.onclick=()=>void load();cancel.onclick=()=>{resetDraft();render();};
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!owns()||!input.value.trim())return;
    const session=app.captureWalletSession(),target=mint,version=generation;
    requestId ||= crypto.randomUUID();const payload={id:requestId,text:input.value,...(edit?{expectedVersion:edit.version}:{})};
    busy=true;render();status.textContent='Verifying creator wallet…';
    try{
      await app.ensureReferralSession(session,{interactive:true});app.assertWalletSessionCurrent(session);
      if(version!==generation||target!==app.getCoinMintAddress?.())throw Error('Token changed. Review your update again.');
      const result=await app.apiRequest(`/api/tokens/${encodeURIComponent(target)}/updates`,{method:'POST',body:payload});
      if(!result.available||!result.data?.update)throw Error('Update confirmation unavailable. Retry with the same draft.');
      app.assertWalletSessionCurrent(session);
      if(target!==mint)return;
      resetDraft();await load();status.textContent='Update published.';
    }catch(error){if(target===mint)status.textContent=error.message;}
    finally{busy=false;render();}
  };
  globalThis.addEventListener?.('funded:coin-facts-loading',()=>{generation++;mint=null;owner=null;rows=[];resetDraft();render();});
  globalThis.addEventListener?.('funded:coin-facts',event=>{if(event.detail?.mint===app.getCoinMintAddress?.())void load();});
  globalThis.addEventListener?.('funded:reward-identity-change',()=>{resetDraft();render();});
  if(app.getCoinMintAddress?.())void load();
  return true;
}
