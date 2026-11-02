import {initAdminAgencyRules} from './admin-agency-rules.js';
export function initAdminAgencyPolicy({api,post,show,refresh}) {
  const anchor=document.querySelector('#fee-form')?.closest('section');
  if(!anchor)return;
  const panel=document.createElement('section');panel.className='panel';
  panel.innerHTML=`<h2>Publish verified agency fee configuration</h2><p>The router authority must first finalize its configuration transaction. This publishes the matching on-chain rates for future launches. Existing coins retain their saved rates.</p>
    <form id="agency-policy-form"><div class="withdraw-fields"><label>Finalized configuration signature<input name="signature" pattern="[1-9A-HJ-NP-Za-km-z]{64,88}" required spellcheck="false"></label><label>On-chain configuration revision<input name="configRevision" pattern="[1-9][0-9]{0,19}" required></label><label>Audit reason<input name="reason" minlength="10" maxlength="500" required></label></div><p data-agency-policy-review role="status">Review the authority-approved transaction and its rates before publishing.</p><button type="submit">Verify transaction and publish for new launches</button></form>`;
  anchor.after(panel);
  initAdminAgencyRules({api,post,show,refresh});
  const form=panel.querySelector('form'),status=panel.querySelector('[data-agency-policy-review]');
  const workspace=panel.closest('#workspace');let busy=false,generation=0;
  const current=(epoch,request)=>request===generation&&(!workspace||!workspace.hidden&&workspace.dataset.sessionEpoch===epoch);
  const controls=()=>{for(const node of form.querySelectorAll('input,button'))node.disabled=busy||!!workspace?.hidden;};
  if(workspace)new MutationObserver(()=>{
    if(workspace.hidden){generation++;busy=false;form.reset();status.textContent='Review the authority-approved transaction and its rates before publishing.';}controls();
  }).observe(workspace,{attributes:true,attributeFilter:['hidden']});controls();
  form.addEventListener('submit',event=>{event.preventDefault();
    if(busy||workspace?.hidden||!form.reportValidity())return;
    const epoch=workspace?.dataset.sessionEpoch,request=++generation;
    const input={signature:form.elements.signature.value.trim(),configRevision:form.elements.configRevision.value.trim(),reason:form.elements.reason.value.trim()};
    busy=true;controls();(async()=>{
    const policy=await api('/api/fee-policy');
    if(request!==generation||workspace?.hidden||workspace&&workspace.dataset.sessionEpoch!==epoch)return;
    const result=await post('/api/admin/agency-fee-policy',{expectedRevision:policy.revision,...input});
    if(request!==generation||workspace?.hidden||workspace&&workspace.dataset.sessionEpoch!==epoch)return;
    const rates=result.split.referralLevelPercents.map(rate=>Number((rate/5).toFixed(6)));
    status.textContent=`Published revision ${result.revision}: L1 ${rates[0]}% · L2 ${rates[1]}% · L3 ${rates[2]}% of gross collected creator fees. Configuration revision ${result.configRevision}; finalized slot ${result.configSlot}.`;
    show('Authority-signed policy verified and published for future launches.');await refresh();
  })().catch(error=>{if(current(epoch,request))show(error.message,true);}).finally(()=>{if(current(epoch,request)){busy=false;controls();}});});
}
