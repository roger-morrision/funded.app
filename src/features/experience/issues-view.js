import { panel, el, button, array, utc, address, signature } from './view-utils.js';
const KEY='funded.issue-reports.v1';
export function initializeIssuesView(app) {
  const parent=document.querySelector('#profile');if(!parent)return;
  const root=panel('issue-reports','Report a problem or suggest an improvement','No token holding or X account is required. Review the report before sending; leave out credentials and private keys.');
  const form=el('form'),category=el('select');category.setAttribute('aria-label','Report category');
  for(const [value,label] of [['bug','Bug'],['impersonation','Impersonation'],['spam','Spam'],['request','Feature request']]){const option=el('option',label);option.value=value;category.append(option);}
  const label=el('label','Describe what happened'),description=el('textarea');description.required=true;description.minLength=10;description.maxLength=2000;description.rows=4;label.append(description);
  const include=el('input');include.type='checkbox';const consent=el('label','Include the current app route and optional public transaction context');consent.prepend(include);
  const preview=el('pre');preview.hidden=true;const status=el('p','Checking report service…');status.setAttribute('role','status');
  let prepared=null,enabled=false,sourceContext=null;const submit=button('Send reviewed report',()=>void send());submit.disabled=true;
  document.addEventListener('click',event=>{const target=event.target.closest('[data-report-context]');if(!target)return;try{const url=new URL(target.dataset.reportContext,location.origin);if(url.origin===location.origin){sourceContext=url;prepared=null;submit.disabled=true;preview.hidden=true;}}catch{}},true);
  form.append(category,label,consent,button('Review report',()=>{
    if(!form.reportValidity())return;const url=sourceContext||new URL(location.href),mint=url.pathname.match(/^\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1]||url.searchParams.get('mint');
    prepared={category:category.value,description:description.value,context:include.checked?{route:url.pathname+url.hash,mint:address(mint)?mint:null,signature:signature(url.searchParams.get('receipt'))?url.searchParams.get('receipt'):null}: {route:'/'}};
    preview.textContent=JSON.stringify(prepared,null,2);preview.hidden=false;submit.disabled=!enabled;status.textContent=enabled?'Review this exact report, then send it.':'Report service unavailable. Save the reviewed text locally.';
  }),preview,button('Copy reviewed report',async()=>{if(!prepared){status.textContent='Review the report first.';return;}try{await navigator.clipboard.writeText(JSON.stringify(prepared,null,2));status.textContent='Reviewed report copied. You can save it locally.';}catch{status.textContent='Copy is unavailable. Select the reviewed text above and save it.';}}),submit,status);root.append(form);parent.append(root);
  const history=el('div');root.append(history);
  const saved=()=>{try{return array(JSON.parse(localStorage.getItem(KEY)||'[]')).filter(row=>/^[a-f0-9]{32}$/.test(row.id)&&/^[a-f0-9]{48}$/.test(row.token)).slice(-20);}catch{return [];}};
  async function render(){history.replaceChildren(el('h3','Your report status'));
    for(const row of saved()){
      const item=el('p'),label=el('span',`${row.id.slice(0,10)}… · ${row.status} · ${utc(row.at)} `);item.append(label);
      item.append(button('Check status',async()=>{
        try{const result=await app.apiRequest(`/api/creator-support/issues/${row.id}`,{headers:{'x-issue-token':row.token},signal:AbortSignal.timeout(10000)});
          if(!result.available)throw new Error();label.textContent=`${result.data.status} · ${result.data.note || 'No reviewer note yet.'} · ${utc(result.data.updatedAt)}`;}
        catch{status.textContent='Status lookup unavailable. Your saved report reference is preserved.';}
      }));history.append(item);
    }
  }
  async function send(){if(!prepared||!enabled)return;submit.disabled=true;
    try{const result=await app.apiRequest('/api/creator-support/issues',{method:'POST',body:prepared,signal:AbortSignal.timeout(15000)});
      if(!result.available || !/^[a-f0-9]{32}$/.test(result.data?.id)||!/^[a-f0-9]{48}$/.test(result.data?.token)||result.data.status!=='received')throw new Error('Submission outcome is unavailable. Preserve the reviewed text before retrying.');
      try{localStorage.setItem(KEY,JSON.stringify([...saved(),{id:result.data.id,token:result.data.token,status:result.data.status,at:result.data.createdAt}].slice(-20)));}
      catch{status.textContent='Report received, but device storage is unavailable. Copy this reference and access token for status checks: '+result.data.id+' / '+result.data.token;return;}
      status.textContent='Report received. Check its status below.';prepared=null;description.value='';preview.hidden=true;await render();
    }catch(error){status.textContent=error.message;submit.disabled=false;}
  }
  form.addEventListener('input',()=>{prepared=null;submit.disabled=true;preview.hidden=true;});form.addEventListener('submit',event=>event.preventDefault());
  app.apiRequest('/api/creator-support/issues/config',{signal:AbortSignal.timeout(10000)}).then(result=>{enabled=result.available&&result.data?.enabled===true&&result.data.cluster==='devnet';status.textContent=enabled?'Report service ready. Review a report before sending.':'Reporting is unavailable from this API. You can still describe and review the issue.';}).catch(()=>{status.textContent='Reporting is unavailable from this API.';});
  void render();
}
