export function initAdminResidualReview({document=globalThis.document,post,show}){
  const workspace=document.getElementById('workspace');
  if(!workspace)return;
  const panel=document.createElement('section');
  panel.className='panel';panel.id='residual-audit';
  panel.innerHTML='<h2>V3 allocation audit</h2><p>Review finalized beneficiary caps, original allocations and transfer receipts. An approval records an audit plan; it does not send funds. Reward-vault funding is not a holder or X recipient payment.</p><form id="residual-audit-form"><div class="withdraw-fields"><label>Devnet mint<input name="mint" required autocomplete="off" spellcheck="false"></label><label>Audit reason<input name="reason" minlength="10" maxlength="500"></label></div><div class="actions"><button type="submit">Review finalized allocations</button><button type="button" data-residual-approve disabled>Approve reviewed audit</button></div></form><p data-residual-status role="status">No allocation audit reviewed.</p><pre data-residual-preview style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>';
  workspace.append(panel);
  const form=panel.querySelector('form'),mint=form.elements.namedItem('mint'),reason=form.elements.namedItem('reason');
  const reviewButton=form.querySelector('[type=submit]'),approveButton=panel.querySelector('[data-residual-approve]');
  const status=panel.querySelector('[data-residual-status]'),preview=panel.querySelector('[data-residual-preview]');
  let reviewed=null,approved=false,busy=false,generation=0;
  const unpaidOriginalWallet=plan=>plan.sources.reduce((sum,row)=>{
    const original=BigInt(row.originalCreatorDirected?.walletLamports||'0');
    const paid=(row.verifiedTransfers||[]).filter(receipt=>receipt.kind==='creator-wallet')
      .reduce((total,receipt)=>total+BigInt(receipt.amount),0n);
    if(paid>original)throw new Error('Legacy wallet receipts exceed the frozen original obligation.');
    return sum+original-paid;
  },0n);
  function render(){
    mint.disabled=busy;reason.disabled=busy;reviewButton.disabled=busy;
    approveButton.disabled=busy||!reviewed||approved;
    if(!reviewed)return;
    if(reviewed.status==='reviewed-legacy-preservation-no-transfer'){
      const unpaid=unpaidOriginalWallet(reviewed);
      status.textContent=`${approved?'Approved':'Reviewed'} no-transfer legacy preservation. Corrective residual: 0 lamports. Original creator-wallet obligation still unpaid: ${unpaid} lamports; it retains its original authorization and amount. Reward-vault funding is not a holder or X payment.`;
    }else status.textContent=`${approved?'Approved':'Reviewed'} protected residual audit. No transfer or recipient payment is confirmed by this plan.`;
  }
  function clear(){generation++;reviewed=null;approved=false;preview.textContent='';
    status.textContent='No allocation audit reviewed.';render();}
  const run=async action=>{if(busy)return;busy=true;render();try{await action();}
    catch(error){show(error.message,true);}finally{busy=false;render();}};
  mint.addEventListener('input',clear);
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!form.reportValidity())return;
    clear();const token=generation,selected=mint.value.trim();
    void run(async()=>{
      const plan=await post('/api/admin/v3-allocations/review',{mint:selected});
      if(token!==generation||mint.value.trim()!==selected)return;
      if(plan.mint!==selected||!/^[a-f0-9]{64}$/.test(plan.hash||'')||!Array.isArray(plan.sources)
        ||!['reviewed-legacy-preservation-no-transfer','reviewed-residual-not-paid'].includes(plan.status))
        throw new Error('Unexpected allocation audit response.');
      if(plan.status==='reviewed-legacy-preservation-no-transfer'
        &&plan.sources.some(row=>!Array.isArray(row.unreleasedLamports)
          ||row.unreleasedLamports.length!==3||row.unreleasedLamports.some(amount=>amount!=='0')
          ||!row.originalCreatorDirected||!/^(0|[1-9]\d*)$/.test(row.originalCreatorDirected.walletLamports)
          ||!Array.isArray(row.verifiedTransfers)
          ||row.verifiedTransfers.some(receipt=>receipt.kind==='creator-wallet'
            &&!/^(0|[1-9]\d*)$/.test(receipt.amount))))
        throw new Error('A legacy preservation plan cannot approve a corrective transfer.');
      if(plan.status==='reviewed-legacy-preservation-no-transfer')unpaidOriginalWallet(plan);
      reviewed=plan;preview.textContent=JSON.stringify(plan,null,2);
    });
  });
  approveButton.addEventListener('click',()=>{
    if(!reviewed||approved||busy)return;
    if(reason.value.trim().length<10){show('Enter an audit reason of at least 10 characters.',true);return;}
    const token=generation,plan=reviewed;
    void run(async()=>{
      const result=await post('/api/admin/v3-allocations/approve',
        {mint:plan.mint,expectedHash:plan.hash,reason:reason.value.trim()});
      if(token!==generation)return;
      if(result.plan?.hash!==plan.hash||result.executionStatus!=='not-executed')
        throw new Error('Allocation audit changed or execution state is uncertain; review again.');
      approved=true;show('Allocation audit approved. No funds moved.');
    });
  });
  render();return{clear};
}
