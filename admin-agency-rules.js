import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {Connection,Transaction} from '@solana/web3.js';
import {validateAgencyRules} from './config/agency-rules.js';
import {verifyPreparedAgencyRules} from './agency-rules-review.js';

export function initAdminAgencyRules({api,post,show,refresh}){
  const anchor=document.querySelector('#agency-policy-form')?.closest('section');if(!anchor)return;
  const panel=document.createElement('section');panel.className='panel';
  panel.innerHTML=`<h2>Future-launch rules</h2>
    <p>Keep the creator-directed 80%. The published app allocation is 8% for Operations &amp; marketing; referrals, Daily bonus and both buyback programs have separate budgets. Review each allocation below as a percentage of collected creator fees. Changes require the router authority wallet and a finalized transaction. Existing coins and open claims keep their saved terms. X publishing stays paused.</p>
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
  let current,prepared,generation=0,signing=false;
  const workspace=document.querySelector('#workspace'),active=epoch=>!workspace||!workspace.hidden&&workspace.dataset.sessionEpoch===epoch;
  const controls=()=>{
    form.querySelector('fieldset').disabled=signing||!current||!!workspace?.hidden;
    panel.querySelector('[data-rules-load]').disabled=signing||!!workspace?.hidden;
    sign.disabled=signing;
  };
  const invalidate=()=>{generation++;prepared=null;sign.hidden=true;};form.addEventListener('input',invalidate);
  panel.querySelector('[data-rules-load]').addEventListener('click',()=>load().catch(error=>show(error.message,true)));
  async function load(afterSave=false){
    if(signing&&!afterSave||workspace?.hidden)return;
    invalidate();const serial=generation,value=await api('/api/admin/agency-rules');if(serial!==generation)return;current=value;const split=current.protocolSplit,rules=current.rules;
    if(!current.verified||!rules)throw new Error('Verified program settings are unavailable.');
    const values={operations:split.operationsPercent/5,l1:split.referralLevelPercents[0]/5,l2:split.referralLevelPercents[1]/5,
      l3:split.referralLevelPercents[2]/5,bonus:split.communityPercent/5,buyback:split.buybackPercent/5,agency:split.agencyPercent/5,
      cap1:rules.marketCapUsd[0],cap2:rules.marketCapUsd[1],window:rules.communityWindowSeconds,
      interval:rules.promotionIntervalSeconds,recipient:current.promotionRecipient};
    for(const[name,value]of Object.entries(values))form.elements[name].value=value;
    controls();status.textContent=`Verified configuration revision ${current.revision}. Required signer: ${current.authority}.`;
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(signing||!current||workspace?.hidden)return;invalidate();const serial=generation;(async()=>{
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
  if(workspace)new MutationObserver(()=>{
    if(workspace.hidden){invalidate();current=null;form.reset();status.textContent='Load settings to verify the current on-chain revision.';}controls();
  }).observe(workspace,{attributes:true,attributeFilter:['hidden']});controls();
  sign.addEventListener('click',()=>{if(signing)return;const epoch=workspace?.dataset.sessionEpoch;if(!active(epoch))return;signing=true;(async()=>{
    const provider=window.phantom?.solana||window.solana,review=prepared;
    if(!review||provider?.publicKey?.toBase58()!==review.authority||!provider.signTransaction)
      throw new Error(`Connect the router authority wallet ${review?.authority||current?.authority} to sign this configuration.`);
    controls();const reason=form.elements.reason.value.trim();
    const rpc=new Connection(`${location.origin}/api/solana/rpc`,'finalized');
    if(await rpc.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw new Error('The browser RPC is not Devnet.');
    if(!active(epoch))return;
    if(prepared!==review)throw new Error('Configuration review changed. Prepare it again.');
    const tx=Transaction.from(Buffer.from(review.transaction,'base64')),message=Buffer.from(tx.serializeMessage()),signed=await provider.signTransaction(tx);
    if(!active(epoch))return;
    if(prepared!==review||provider.publicKey?.toBase58()!==review.authority||!Buffer.from(signed.serializeMessage()).equals(message))throw new Error('Configuration review changed. Prepare it again.');
    if(!(await rpc.isBlockhashValid(review.blockhash,'confirmed')).value)throw new Error('Configuration review expired. Prepare it again.');
    if(!active(epoch))return;
    const wire=signed.serialize(),signature=bs58.encode(signed.signature);
    status.textContent=`Configuration prepared: ${signature}. Check this exact transaction before preparing another update.`;
    const recovery=document.querySelector('#agency-policy-form');
    if(recovery){recovery.elements.signature.value=signature;recovery.elements.configRevision.value=String(BigInt(review.configRevision)+1n);}
    prepared=null;sign.hidden=true;
    const sent=await rpc.sendRawTransaction(wire,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2});
    if(sent!==signature)throw new Error('RPC returned a different signature. Reconcile the saved configuration.');
    if(!active(epoch))return;
    status.textContent=`Configuration submitted: ${signature}. Waiting for finalization; do not submit another update.`;
    const result=await rpc.confirmTransaction({signature,blockhash:review.blockhash,lastValidBlockHeight:review.lastValidBlockHeight},'finalized');
    if(!active(epoch))return;
    if(result.value.err)throw new Error('Configuration transaction failed.');
    const published=await api('/api/fee-policy');
    if(!active(epoch))return;
    await post('/api/admin/agency-fee-policy',{expectedRevision:published.revision,signature,
      configRevision:String(BigInt(review.configRevision)+1n),reason});
    if(!active(epoch))return;
    show(`Settings finalized and published: ${signature}`);await load(true);if(active(epoch))await refresh();
  })().catch(error=>{if(active(epoch))show(error.message,true);}).finally(()=>{signing=false;controls();});});
}
