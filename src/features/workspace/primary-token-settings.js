import {configuredDevnetProgram} from '../../../configured-devnet-program.js';
import {preparePrimaryTokenChange,confirmPrimaryTokenChange} from '../../../primary-token-change.js';
import './primary-token-settings.css';

export function mountPrimaryTokenSettings(appState){
  if(!configuredDevnetProgram(appState.APP_CLUSTER,appState.FEE_ROUTER_PROGRAM_ID))return;
  const page=document.getElementById('profile');if(!page)return;
  const panel=document.createElement('details');panel.id='primary-token-settings';panel.className='panel';
  panel.innerHTML=`<summary>Primary app token</summary><p>The administrator wallet can select the app token and its SOL market. Each confirmed change creates a new on-chain revision.</p>
    <dl><dt>Current token</dt><dd data-primary-current></dd><dt>Revision</dt><dd data-primary-revision></dd><dt>Administrator</dt><dd data-primary-owner></dd></dl>
    <button type="button" data-primary-refresh>Refresh configuration</button>
    <form data-primary-form><label>New token mint<input name="mint" required autocomplete="off"></label>
    <label>SOL market address<input name="market" required autocomplete="off"></label>
    <label>Market type<select name="venue"><option value="0">PumpSwap SOL pool</option><option value="1">Pump SOL bonding curve</option></select></label>
    <button type="submit" data-primary-review>Review change</button></form>
    <p data-primary-review-summary hidden></p><button type="button" data-primary-sign hidden>Sign token change</button>
    <button type="button" data-primary-confirm hidden>Check confirmation</button>
    <p data-primary-status role="status" aria-live="polite"></p><a data-primary-receipt hidden target="_blank" rel="noopener">View transaction</a>
    <button type="button" data-primary-reload hidden>Reload app with current token</button>`;
  page.append(panel);
  const find=selector=>panel.querySelector(selector),status=find('[data-primary-status]'),form=find('form');
  const journalKey=`funded.primary-token.pending:${appState.FEE_ROUTER_PROGRAM_ID}`;
  let current=null,prepared=null,pending=null,busy=false;
  try{pending=JSON.parse(sessionStorage.getItem(journalKey));}catch{/* No stored public receipt. */}
  const message=text=>{status.textContent=text;};
  function controls(){
    const owner=current?.authority===appState.connectedWalletAddress;
    find('[data-primary-review]').disabled=busy||!owner||Boolean(pending);
    find('[data-primary-sign]').hidden=!prepared||Boolean(pending);find('[data-primary-sign]').disabled=busy||!owner;
    find('[data-primary-confirm]').hidden=!pending;find('[data-primary-confirm]').disabled=busy;
    if(current&&!owner&&!busy)message('Connect the administrator wallet to change the primary token.');
  }
  async function refresh(){
    const response=await appState.apiRequest('/api/token-config');
    if(!response.available||response.data?.configuration!=='onchain-v1'||response.data.programId!==appState.FEE_ROUTER_PROGRAM_ID)throw Error('Current token configuration is unavailable.');
    current=response.data;prepared=null;
    find('[data-primary-current]').textContent=current.fundedMint;find('[data-primary-revision]').textContent=current.revision;
    find('[data-primary-owner]').textContent=current.authority;controls();
  }
  async function check(){
    if(!pending)return;
    const result=await confirmPrimaryTokenChange(appState.connection,pending);
    if(!result){message('Transaction pending finality. Check confirmation before attempting another change.');return;}
    sessionStorage.removeItem(journalKey);pending=null;prepared=null;await refresh();
    message(`Confirmed revision ${result.revision}. Reload the app to use its current primary token.`);
    find('[data-primary-receipt]').href=`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`;find('[data-primary-receipt]').hidden=false;
    find('[data-primary-reload]').hidden=false;panel.dataset.finalizedRevision=result.revision;controls();
  }
  async function run(action){if(busy)return;busy=true;controls();try{await action();}catch(error){message(error.message||'The change could not be verified.');}finally{busy=false;controls();}}
  form.addEventListener('input',()=>{prepared=null;find('[data-primary-review-summary]').hidden=true;controls();});
  form.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    const session=appState.captureWalletSession();if(!session||!current)throw Error('Connect the administrator wallet.');
    const fields=new FormData(form);
    prepared=await preparePrimaryTokenChange({connection:appState.connection,cluster:appState.APP_CLUSTER,programId:appState.FEE_ROUTER_PROGRAM_ID,
      owner:session.address,mint:String(fields.get('mint')).trim(),market:String(fields.get('market')).trim(),venue:Number(fields.get('venue')),revision:current.revision});
    appState.assertWalletSessionCurrent(session);
    const summary=find('[data-primary-review-summary]');summary.hidden=false;
    summary.textContent=`Revision ${prepared.nextRevision}: ${prepared.expected.mint}, market ${prepared.expected.market}. Estimated cost ${(prepared.estimatedLamports/1e9).toFixed(6)} Devnet SOL.`;
    message('Review the token, market and revision, then sign with your administrator wallet.');
  });});
  find('[data-primary-sign]').addEventListener('click',()=>void run(async()=>{
    if(!prepared||pending)return;const session=appState.captureWalletSession();appState.assertWalletSessionCurrent(session);
    if(session.address!==prepared.expected.authority)throw Error('Administrator wallet changed. Review again.');
    const response=await appState.apiRequest('/api/token-config');
    if(!response.available||String(BigInt(response.data.revision)+1n)!==prepared.nextRevision)throw Error('Configuration changed. Refresh and review again.');
    const messageBytes=prepared.transaction.serializeMessage();
    const signed=await session.provider.signTransaction(prepared.transaction);appState.assertWalletSessionCurrent(session);
    if(!signed.serializeMessage().equals(messageBytes)||!signed.verifySignatures())throw Error('Wallet changed the reviewed transaction. Nothing was sent.');
    const signature=appState.bs58.encode(signed.signature);
    pending={...prepared.expected,signature,blockhash:prepared.latest.blockhash,lastValidBlockHeight:prepared.latest.lastValidBlockHeight};
    sessionStorage.setItem(journalKey,JSON.stringify(pending));
    find('[data-primary-receipt]').href=`https://explorer.solana.com/tx/${signature}?cluster=devnet`;find('[data-primary-receipt]').hidden=false;
    const sent=await appState.connection.sendRawTransaction(signed.serialize(),{skipPreflight:false,maxRetries:2});
    if(sent!==signature)throw Error('Transaction result is uncertain. Check the recorded signature.');
    message('Submitted. Waiting for finalized confirmation.');
    for(let i=0;i<20&&pending;i++){await new Promise(resolve=>setTimeout(resolve,1500));await check();}
  }));
  find('[data-primary-confirm]').addEventListener('click',()=>void run(check));
  find('[data-primary-refresh]').addEventListener('click',()=>void run(refresh));
  find('[data-primary-reload]').addEventListener('click',()=>location.reload());
  window.addEventListener('funded:reward-identity-change',controls);
  void run(refresh);
}
