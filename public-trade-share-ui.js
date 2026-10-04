/** Optional, explicit permission to publish one exact Devnet trade pair. */
export function validatePublicSharePreview(preview, trade, origin) {
  if (preview?.origin !== origin || preview.cluster !== 'devnet' || preview.wallet !== trade.wallet || preview.mint !== trade.mint
    || !/^[a-z0-9_]{1,15}$/.test(preview.account || '') || !/^[A-Za-z0-9_-]{43}$/.test(preview.challengeId || '')
    || !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= Date.now()) throw new Error('The sharing request does not match this wallet, trade or app.');
  const lines = String(preview.statement || '').split('\n');
  const required = ['funded.app public closed-trade sharing consent v1', 'Purpose: publish-closed-trade-on-x',
    `Origin: ${origin}`, `X account: @${preview.account}`, 'Network: Solana Devnet (test funds)',
    `Wallet: ${trade.wallet}`, `Mint: ${trade.mint}`, `Buy receipt: ${trade.buyReceipt}`, `Sell receipt: ${trade.receipt}`,
    `Signature acceptance deadline: ${preview.expiresAt}`, `Challenge: ${preview.challengeId}`,
    'I authorize one factual public X summary of this exact closed trade after receipt verification. This does not authorize future trades or transactions.'];
  if (lines.length !== 13 || required.some(line => !lines.includes(line)) || !/^Issued at: \d{4}-/.test(lines[9])) throw new Error('The sharing statement is not the expected one-trade permission.');
  return preview;
}

export async function mountPublicTradeShare(dialog, trade, approval) {
  dialog.querySelector('#public-trade-share')?.remove();
  if (trade?.kind !== 'roundtrip' || trade.network !== 'devnet' || !approval) return;
  const section = document.createElement('details'); section.id = 'public-trade-share';
  section.hidden = true;
  section.innerHTML = '<summary>Optional: request a platform X post</summary><p>This permission identifies your public wallet and exact buy/sell receipts. Only supported, fully closed direct Pump trades with at least 1 Devnet SOL profit after attributable fees qualify. Test SOL has no monetary value.</p><button type="button" class="secondary-button" id="public-share-preview">Review publication permission</button><pre id="public-share-statement" hidden style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre><label id="public-share-permission" hidden><input id="public-share-allow" type="checkbox"> <span></span></label><button type="button" class="secondary-button" id="public-share-sign" hidden disabled>Sign permission</button><p id="public-share-status" role="status" aria-live="polite"></p>';
  dialog.querySelector('#share-status')?.before(section);
  const previewButton=section.querySelector('#public-share-preview'),signButton=section.querySelector('#public-share-sign'),allow=section.querySelector('#public-share-allow'),status=section.querySelector('#public-share-status');
  let preview=null, signature=null, busy=false, disposed=false;
  const current=()=>!disposed && dialog.open && section.isConnected;
  dialog.addEventListener('close',()=>{disposed=true;},{once:true});
  const request=async(path,body)=>{
    const response=await fetch(`/api/x-public-trade-shares/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error || 'Public sharing is unavailable. Retry shortly.');return data;
  };
  try {
    const response=await fetch('/api/x-public-trade-shares/config',{signal:AbortSignal.timeout(8000)});
    const config=await response.json();
    if(!response.ok || !config.enabled || config.cluster !== 'devnet' || config.origin !== location.origin || !current()) { section.remove(); return; }
    section.hidden=false;
  } catch { section.remove(); return; }
  previewButton.addEventListener('click',async()=>{
    if(busy)return;busy=true;previewButton.disabled=true;status.textContent='Preparing your exact trade permission…';
    try{
      approval.assertCurrent();
      const prepared=await request('challenge',{wallet:trade.wallet,mint:trade.mint,buySignature:trade.buyReceipt,sellSignature:trade.receipt});
      if(!current())return;approval.assertCurrent();preview=validatePublicSharePreview(prepared,trade,location.origin);signature=null;
      const statement=section.querySelector('#public-share-statement');statement.textContent=preview.statement;statement.hidden=false;
      const permission=section.querySelector('#public-share-permission');permission.hidden=false;permission.querySelector('span').textContent=`I allow @${preview.account} to publish this exact trade with my public wallet and receipts.`;
      allow.checked=false;signButton.hidden=false;signButton.disabled=true;previewButton.hidden=true;
      status.textContent='Review the full statement. Signing authorizes one public post; it sends no transaction.';allow.focus();
    }catch(error){if(current())status.textContent=error.name==='TimeoutError'?'Permission request timed out. Try again.':error.message;}
    finally{busy=false;previewButton.disabled=false;}
  });
  allow.addEventListener('change',()=>{signButton.disabled=busy||!allow.checked;});
  signButton.addEventListener('click',async()=>{
    if(busy||!allow.checked||!preview)return;busy=true;signButton.disabled=true;allow.disabled=true;
    try{
      approval.assertCurrent();
      if(!signature){validatePublicSharePreview(preview,trade,location.origin);status.textContent='Review and approve the message in your wallet.';signature=await approval.sign(preview.statement);}
      if(!current())return;approval.assertCurrent();status.textContent='Verifying finalized receipts and saving permission…';
      await request('consent',{challengeId:preview.challengeId,signature});
      if(!current())return;
      status.textContent='Permission saved. Publication depends on independent verification and the platform posting settings.';signButton.hidden=true;section.querySelector('#public-share-permission').hidden=true;
    }catch(error){if(current()){status.textContent=error.name==='TimeoutError'?'Confirmation timed out. Retry to check the same permission.':error.message;signButton.textContent=signature?'Retry same permission':'Sign permission';
      if(!signature && Date.parse(preview.expiresAt)<=Date.now()){previewButton.hidden=false;previewButton.textContent='Review a new permission';allow.checked=false;signButton.hidden=true;section.querySelector('#public-share-permission').hidden=true;}}}
    finally{busy=false;allow.disabled=false;signButton.disabled=!allow.checked;}
  });
}
