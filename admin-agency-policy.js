export function initAdminAgencyPolicy({api,post,show,refresh}) {
  const anchor=document.querySelector('#fee-form')?.closest('section');
  if(!anchor)return;
  const panel=document.createElement('section');panel.className='panel';
  panel.innerHTML=`<h2>Publish verified agency fee configuration</h2><p>The router authority must first finalize its configuration transaction. This publishes the matching on-chain rates for future launches. Existing coins retain their saved rates.</p>
    <form id="agency-policy-form"><div class="withdraw-fields"><label>Finalized configuration signature<input name="signature" pattern="[1-9A-HJ-NP-Za-km-z]{64,88}" required spellcheck="false"></label><label>On-chain configuration revision<input name="configRevision" pattern="[1-9][0-9]{0,19}" required></label><label>Audit reason<input name="reason" minlength="10" maxlength="500" required></label></div><p data-agency-policy-review role="status">Review the authority-approved transaction and its rates before publishing.</p><button type="submit">Verify transaction and publish for new launches</button></form>`;
  anchor.after(panel);
  const form=panel.querySelector('form'),status=panel.querySelector('[data-agency-policy-review]');
  form.addEventListener('submit',event=>{event.preventDefault();(async()=>{
    const current=await api('/api/fee-policy');
    const result=await post('/api/admin/agency-fee-policy',{expectedRevision:current.revision,
      signature:form.elements.signature.value.trim(),configRevision:form.elements.configRevision.value.trim(),reason:form.elements.reason.value.trim()});
    const rates=result.split.referralLevelPercents.map(rate=>Number((rate/5).toFixed(6)));
    status.textContent=`Published revision ${result.revision}: L1 ${rates[0]}% · L2 ${rates[1]}% · L3 ${rates[2]}% of gross collected creator fees. Configuration revision ${result.configRevision}; finalized slot ${result.configSlot}.`;
    show('Authority-signed policy verified and published for future launches.');await refresh();
  })().catch(error=>show(error.message,true));});
}
