import {Buffer} from 'buffer';
import {Connection,Transaction} from '@solana/web3.js';
import {validateAgencyRules} from './config/agency-rules.js';
import {verifyPreparedAgencyRules} from './agency-rules-review.js';

export function initAdminAgencyRules({api,post,show,refresh}){
  const anchor=document.querySelector('#agency-policy-form')?.closest('section');if(!anchor)return;
  const panel=document.createElement('section');panel.className='panel';
  panel.innerHTML=`<h2>Future-launch rules</h2>
    <p>Keep the creator-directed 80%. Set the remaining 20% below. Changes require the router authority wallet and a finalized transaction. Existing coins and open claims keep their saved terms. X publishing stays paused.</p>
    <button type="button" data-rules-load>Load verified settings</button>
    <form data-rules-form><fieldset disabled><legend>Percentage of gross collected creator fees</legend><div class="withdraw-fields">
    <label>Operations &amp; marketing %<input name="operations" type="number" min="0" max="20" step="0.00002" required></label>
    <label>Referral L1 %<input name="l1" type="number" min="0" max="20" step="0.00002" required></label>
    <label>Referral L2 %<input name="l2" type="number" min="0" max="20" step="0.00002" required></label>
    <label>Referral L3 %<input name="l3" type="number" min="0" max="20" step="0.00002" required></label>
    <label>Daily bonus %<input name="bonus" type="number" min="0" max="20" step="0.00002" required></label>
    <label>$FUNDED buyback %<input name="buyback" type="number" min="0" max="20" step="0.00002" required></label>
    <label>Agency %<input name="agency" type="number" min="0" max="20" step="0.00002" required></label>
    <label>Agent 2 market cap (USD)<input name="cap1" type="number" min="1" max="1000000000" step="1" required></label>
    <label>Agent 3 market cap (USD)<input name="cap2" type="number" min="1" max="1000000000" step="1" required></label>
    <label>Community claim window (seconds)<input name="window" type="number" min="300" max="31536000" step="1" required></label>
    <label>Promotion billing interval (seconds)<input name="interval" type="number" min="86400" max="2592000" step="1" required></label>
    <label>Promotion recipient<input name="recipient" required spellcheck="false"></label>
    <label>Audit reason<input name="reason" minlength="10" maxlength="500" required></label>
    </div><button type="submit">Prepare configuration for review</button></fieldset></form>
    <p data-rules-review role="status">Load settings to verify the current on-chain revision.</p>
    <button type="button" data-rules-sign hidden>Sign, finalize and publish reviewed settings</button>`;
  anchor.after(panel);
  const form=panel.querySelector('form'),status=panel.querySelector('[data-rules-review]'),sign=panel.querySelector('[data-rules-sign]');
  let current,prepared,generation=0;
  const invalidate=()=>{generation++;prepared=null;sign.hidden=true;};form.addEventListener('input',invalidate);
  panel.querySelector('[data-rules-load]').addEventListener('click',()=>load().catch(error=>show(error.message,true)));
  async function load(){
    invalidate();const serial=generation,value=await api('/api/admin/agency-rules');if(serial!==generation)return;current=value;const split=current.protocolSplit,rules=current.rules;
    if(!current.verified||!rules)throw new Error('Verified program settings are unavailable.');
    const values={operations:split.operationsPercent/5,l1:split.referralLevelPercents[0]/5,l2:split.referralLevelPercents[1]/5,
      l3:split.referralLevelPercents[2]/5,bonus:split.communityPercent/5,buyback:split.buybackPercent/5,agency:split.agencyPercent/5,
      cap1:rules.marketCapUsd[0],cap2:rules.marketCapUsd[1],window:rules.communityWindowSeconds,
      interval:rules.promotionIntervalSeconds,recipient:current.promotionRecipient};
    for(const[name,value]of Object.entries(values))form.elements[name].value=value;
    form.querySelector('fieldset').disabled=false;status.textContent=`Verified configuration revision ${current.revision}. Required signer: ${current.authority}.`;
  }
  form.addEventListener('submit',event=>{event.preventDefault();invalidate();const serial=generation;(async()=>{
    const n=name=>Number(form.elements[name].value),split={operationsPercent:n('operations')*5,
      referralLevelPercents:['l1','l2','l3'].map(name=>n(name)*5),communityPercent:n('bonus')*5,
      buybackPercent:n('buyback')*5,agencyPercent:n('agency')*5};
    const rules=validateAgencyRules({marketCapUsd:[n('cap1'),n('cap2')],communityWindowSeconds:n('window'),promotionIntervalSeconds:n('interval')});
    const input={expectedRevision:current.revision,split,rules,promotionRecipient:form.elements.recipient.value.trim()};
    const candidate=await post('/api/admin/agency-rules',input);
    if(serial!==generation)throw new Error('Settings changed during preparation. Review them again.');
    verifyPreparedAgencyRules(candidate,{...input,programId:current.programId,authority:current.authority});prepared=candidate;
    status.textContent=`Review: Operations ${n('operations')}%, referrals ${n('l1')}% / ${n('l2')}% / ${n('l3')}%, Daily bonus ${n('bonus')}%, buyback ${n('buyback')}%, agency ${n('agency')}%. Agent thresholds $${n('cap1')} / $${n('cap2')}; claim window ${n('window')} seconds; promotion billing interval ${n('interval')} seconds; recipient ${prepared.promotionRecipient}. Future launches only. Network fees and account storage may apply.`;
    sign.hidden=false;
  })().catch(error=>show(error.message,true));});
  sign.addEventListener('click',()=>{(async()=>{
    const provider=window.phantom?.solana||window.solana,review=prepared;
    if(!review||provider?.publicKey?.toBase58()!==review.authority||!provider.signTransaction)
      throw new Error(`Connect the router authority wallet ${review?.authority||current?.authority} to sign this configuration.`);
    sign.disabled=true;
    const tx=Transaction.from(Buffer.from(review.transaction,'base64')),message=Buffer.from(tx.serializeMessage()),signed=await provider.signTransaction(tx);
    if(prepared!==review||!Buffer.from(signed.serializeMessage()).equals(message))throw new Error('Configuration review changed. Prepare it again.');
    const rpc=new Connection(`${location.origin}/api/solana/rpc`,'finalized');
    const signature=await rpc.sendRawTransaction(signed.serialize(),{skipPreflight:false});
    status.textContent=`Configuration submitted: ${signature}. Waiting for finalization; do not submit another update.`;
    const recovery=document.querySelector('#agency-policy-form');
    if(recovery){recovery.elements.signature.value=signature;recovery.elements.configRevision.value=String(BigInt(review.configRevision)+1n);}
    const result=await rpc.confirmTransaction({signature,blockhash:review.blockhash,lastValidBlockHeight:review.lastValidBlockHeight},'finalized');
    if(result.value.err)throw new Error('Configuration transaction failed.');
    const published=await api('/api/fee-policy');
    await post('/api/admin/agency-fee-policy',{expectedRevision:published.revision,signature,
      configRevision:String(BigInt(review.configRevision)+1n),reason:form.elements.reason.value.trim()});
    show(`Settings finalized and published: ${signature}`);await load();await refresh();
  })().catch(error=>show(error.message,true)).finally(()=>{sign.disabled=false;});});
}
