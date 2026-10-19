import {Buffer} from 'buffer';
import {Transaction} from '@solana/web3.js';

export function initAdminResiduals({api,post,show,wallet,document=globalThis.document}){
  const workspace=document.getElementById('workspace');if(!workspace)return;
  const panel=document.createElement('section');panel.className='panel';panel.id='residual-recovery';
  panel.innerHTML='<h2>Legacy allocation recovery</h2><p>Review finalized beneficiary caps and receipts, then approve only unpaid residuals. Original allocations and payments remain in the audit history. A reward-vault transfer funds holder/X rewards; it is not a holder or X payment.</p><form id="residual-review-form"><div class="withdraw-fields"><label>Devnet mint<input name="mint" required autocomplete="off" spellcheck="false"></label><label>Audit reason<input name="reason" minlength="10" maxlength="500"></label></div><div class="actions"><button type="submit">Review finalized residuals</button><button type="button" data-residual-approve disabled>Approve reviewed plan</button></div></form><pre data-residual-preview style="white-space:pre-wrap;overflow-wrap:anywhere"></pre><form id="residual-transfer-form"><div class="withdraw-fields"><label>Reviewed source collection<select name="source" required></select></label><label>Action<select name="kind"><option value="creator-wallet">Pay creator wallet residual</option><option value="creator-reward">Fund holder/X reward residuals</option></select></label></div><p data-residual-status role="status">No residual reviewed or approved.</p><button type="submit" disabled>Review and sign as launch creator</button><p data-residual-receipt></p></form>';
  workspace.append(panel);
  const reviewForm=panel.querySelector('#residual-review-form'),transferForm=panel.querySelector('#residual-transfer-form');
  const mint=reviewForm.elements.namedItem('mint'),reason=reviewForm.elements.namedItem('reason');
  const source=transferForm.elements.namedItem('source'),kind=transferForm.elements.namedItem('kind');
  const approve=panel.querySelector('[data-residual-approve]'),submit=transferForm.querySelector('button');
  const preview=panel.querySelector('[data-residual-preview]'),status=panel.querySelector('[data-residual-status]');
  let reviewed=null,approved=false,busy=false,generation=0;
  function render(){
    for(const input of [mint,reason,source,kind])input.disabled=busy;
    approve.disabled=busy||!reviewed||approved;
    submit.disabled=busy||!approved||!source.value;
    reviewForm.querySelector('[type=submit]').disabled=busy;
    const row=reviewed?.sources.find(row=>row.collectionSignature===source.value);
    const preservation=reviewed?.status==='reviewed-legacy-preservation-no-transfer';
    approve.textContent=preservation?'Approve legacy preservation':'Approve reviewed plan';
    const amount=row?(kind.value==='creator-wallet'?BigInt(row.unreleasedLamports[0]):BigInt(row.unreleasedLamports[1])+BigInt(row.unreleasedLamports[2])):0n;
    submit.disabled||=amount===0n;
    if(preservation)status.textContent=`${approved?'Approved':'Reviewed, not approved'} · preserve original legacy funding and receipts. No corrective transfer is approved. Ordinary unpaid allocations retain their original creator-signature flow.`;
    else if(reviewed)status.textContent=`${approved?'Approved':'Reviewed, not approved'} · ${amount} lamports for this action. Launch creator ${reviewed.beneficiaries.creatorWallet} must sign. No recipient payment is confirmed by a review.`;
  }
  function clear(){generation++;reviewed=null;approved=false;source.replaceChildren();preview.textContent='';
    panel.querySelector('[data-residual-receipt]').replaceChildren();status.textContent='No residual reviewed or approved.';render();}
  const run=async action=>{if(busy)return;busy=true;render();try{await action();}catch(error){show(error.message,true);}finally{busy=false;render();}};
  mint.addEventListener('input',clear);source.addEventListener('change',render);kind.addEventListener('change',render);
  reviewForm.addEventListener('submit',event=>{
    event.preventDefault();if(!reviewForm.reportValidity())return;clear();const token=generation,selected=mint.value.trim();
    void run(async()=>{
      const result=await post('/api/admin/v3-allocations/review',{mint:selected});
      if(token!==generation||mint.value.trim()!==selected)return;
      if(result.mint!==selected||!/^[a-f0-9]{64}$/.test(result.hash)||!Array.isArray(result.sources))throw new Error('Unexpected residual review.');
      reviewed=result;preview.textContent=JSON.stringify(result,null,2);
      for(const row of result.sources){const option=document.createElement('option');option.value=row.collectionSignature;
        option.textContent=`${row.collectionSignature.slice(0,8)}… · wallet ${row.unreleasedLamports[0]} / holders ${row.unreleasedLamports[1]} / X ${row.unreleasedLamports[2]} lamports`;source.append(option);}
    });
  });
  approve.addEventListener('click',()=>{
    if(!reviewed||approved||busy)return;
    if(reason.value.trim().length<10){show('Enter an audit reason of at least 10 characters.',true);return;}
    const token=generation,plan=reviewed;
    void run(async()=>{
      const result=await post('/api/admin/v3-allocations/approve',{mint:plan.mint,expectedHash:plan.hash,reason:reason.value.trim()});
      if(token!==generation)return;
      if(result.plan?.hash!==plan.hash)throw new Error('Residual approval changed; review again.');
      approved=true;show('Residual plan approved. No funds have moved.');
    });
  });
  transferForm.addEventListener('submit',event=>{
    event.preventDefault();if(submit.disabled||!approved)return;
    const token=generation,plan=reviewed,selected=source.value,action=kind.value;
    void run(async()=>{
      const provider=wallet();
      if(!provider?.signTransaction||provider.publicKey?.toBase58()!==plan.beneficiaries.creatorWallet)
        throw new Error(`Connect launch creator ${plan.beneficiaries.creatorWallet} to sign this exact residual. The admin sign-in alone cannot authorize it.`);
      const suffix=action==='creator-wallet'?'payout':'funding';
      const path=`/api/tokens/${encodeURIComponent(plan.mint)}/v3-${action}-${suffix}/${encodeURIComponent(selected)}`;
      let result=await post(path,{residualPlanHash:plan.hash});
      if(token!==generation)return;
      if(result.status==='awaiting-creator-signature'){
        if(!result.transaction)throw new Error('Residual signing request is unavailable.');
        const transaction=Transaction.from(Buffer.from(result.transaction,'base64'));
        const signed=await provider.signTransaction(transaction);
        if(token!==generation||provider.publicKey?.toBase58()!==plan.beneficiaries.creatorWallet)throw new Error('Wallet or reviewed residual changed before submission.');
        result=await post(path,{residualPlanHash:plan.hash,creatorSignedTransaction:signed.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')});
      }
      if(token!==generation)return;
      if(result.status!=='finalized'||result.balanceDeltaVerified!==true||result.residualPlanHash!==plan.hash||!result.signature)
        throw new Error('Residual remains unverified. Reconcile its existing signature before another attempt.');
      const link=document.createElement('a');link.href=`https://explorer.solana.com/tx/${encodeURIComponent(result.signature)}?cluster=devnet`;
      link.target='_blank';link.rel='noopener noreferrer';link.textContent='Verify finalized residual transfer ↗';
      panel.querySelector('[data-residual-receipt]').replaceChildren(link);
      show(action==='creator-wallet'?'Creator residual finalized and verified.':'Reward-vault residual funding finalized. Holder payouts and X claims use their separate verified flows.');
    });
  });
  render();return{clear};
}
