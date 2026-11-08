const AUTH_PATHS=new Set(['/api/admin/challenge','/api/admin/session','/api/admin/logout']);
const actionName=path=>path.includes('/withdrawals/')?'Treasury withdrawal'
  :path.includes('service-fees')?'Service fee update':path.includes('agency')?'Future-launch rules'
    :path.includes('daily-bonus')?'Daily bonus recovery':path.includes('x-posts')?'X publishing review'
      :path.includes('product-issues')?'Issue update':path.includes('v3-allocations')?'Allocation recovery':'Admin change';

export function createConfirmedAdminPost({api,session,confirm=createEmailConfirmationDialog()}){
  let busy=false;
  return async(path,input)=>{
    // Serialize once: edits during email delivery cannot change the approved request.
    const wire=JSON.stringify(input),options={method:'POST',body:wire};
    if(AUTH_PATHS.has(path))return api(path,options);
    if(!path.startsWith('/api/admin/'))throw Error('Admin changes must use an email-protected admin endpoint.');
    if(busy)throw Error('Finish or cancel the current email confirmation first.');
    if(!session.active)throw Error('Sign in with the configured admin wallet.');
    const epoch=session.epoch;
    const assertCurrent=()=>{if(!session.active||!session.current(epoch))throw Error('Previous admin session ended.');};
    busy=true;
    try{
      const confirmation=await api('/api/admin/email-confirmation',{method:'POST',
        body:JSON.stringify({method:'POST',path,payload:JSON.parse(wire)})});
      assertCurrent();
      return await confirm({confirmation,path,payload:JSON.parse(wire),assertCurrent,
        submit:async code=>{
          assertCurrent();
          return api(path,{...options,headers:{'x-admin-confirmation-id':confirmation.id,'x-admin-confirmation-code':code}});
        }});
    }finally{busy=false;}
  };
}

export function createEmailConfirmationDialog({document=globalThis.document}={}){
  return({confirmation,path,payload,assertCurrent,submit})=>new Promise((resolve,reject)=>{
    const dialog=document.createElement('dialog');dialog.className='admin-email-dialog';
    dialog.setAttribute('aria-labelledby','admin-email-title');
    dialog.innerHTML='<form><h2 id="admin-email-title">Confirm admin action</h2><p data-email-description></p><details><summary>Review exact request</summary><pre></pre></details><label>Confirmation code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" minlength="8" maxlength="8" required></label><p data-email-status role="status" aria-live="polite"></p><div class="actions"><button type="button" data-email-cancel>Cancel</button><button type="submit">Verify and continue</button></div></form>';
    const form=dialog.querySelector('form'),field=form.elements.code,status=dialog.querySelector('[data-email-status]');
    dialog.querySelector('[data-email-description]').textContent=`${actionName(path)}: enter the eight-digit code sent to ${confirmation.recipient}. It expires in five minutes and applies only to this request.`;
    dialog.querySelector('pre').textContent=JSON.stringify({action:path,request:payload},null,2);
    let sending=false,closed=false;
    const finish=(error,value)=>{if(closed)return;closed=true;clearInterval(timer);field.value='';dialog.close();dialog.remove();if(error)reject(error);else resolve(value);};
    const timer=setInterval(()=>{
      if(sending)return;
      try{assertCurrent();if(Date.now()>=Date.parse(confirmation.expiresAt))throw Error('Email code expired. Review the action and request a new code.');}
      catch(error){finish(error);}
    },1000);
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!sending)finish(Error('Admin action cancelled.'));});
    dialog.querySelector('[data-email-cancel]').addEventListener('click',()=>{if(!sending)finish(Error('Admin action cancelled.'));});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(sending||!form.reportValidity())return;
      sending=true;for(const control of form.querySelectorAll('button,input'))control.disabled=true;
      status.textContent='Verifying and submitting the reviewed action…';
      try{assertCurrent();finish(null,await submit(field.value.trim()));}
      catch(error){
        // Only an explicit pre-action code rejection permits another attempt.
        // Network failures and business errors never trigger an automatic replay.
        if(error.code==='ADMIN_EMAIL_CONFIRMATION_FAILED'){
          status.textContent=error.message;field.value='';sending=false;
          for(const control of form.querySelectorAll('button,input'))control.disabled=false;field.focus();
        }else finish(error);
      }
    });
    document.body.append(dialog);dialog.showModal();field.focus();
  });
}
