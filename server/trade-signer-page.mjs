import { randomBytes } from 'node:crypto';

export function renderTradeSignerPage(id) {
  const nonce = randomBytes(18).toString('base64');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review funded.vip test network trade</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}
body{max-width:36rem;margin:0 auto;padding:1.4rem 1.1rem 3rem;background:#14111e;color:#f5f1fb}
h1{font-size:clamp(1.75rem,6vw,2.2rem);line-height:1.16;letter-spacing:-.03em;margin:.65rem 0 .45rem}h2{font-size:1.1rem;margin:0 0 1rem}p{line-height:1.5;color:#bdb4cd;margin:.65rem 0}
.eyebrow{color:#80dfb0;font:12px ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase}
.card{margin:1.3rem 0;padding:1.2rem;border:1px solid #49415f;border-radius:1rem;background:#211c30}
.flow{display:grid;gap:.75rem}.amount-block{padding:.15rem 0}.label{display:block;color:#b7aec9;font-size:.84rem;margin-bottom:.25rem}
.amount{display:block;font-size:clamp(1.35rem,5vw,1.7rem);font-weight:750;line-height:1.25;letter-spacing:-.025em;overflow-wrap:anywhere}
.subtle{display:block;color:#a89fba;font-size:.85rem;line-height:1.45;margin-top:.3rem}.arrow{color:#8c7db2;font-size:1.2rem;line-height:1;text-align:center}
.divider{border:0;border-top:1px solid #49415f;margin:1.1rem 0}.detail-grid{display:grid;grid-template-columns:1fr auto;gap:.65rem 1rem;font-size:.9rem}
.detail-grid span{color:#b7aec9}.detail-grid strong{text-align:right;overflow-wrap:anywhere}details{border-top:1px solid #49415f;margin-top:1.1rem;padding-top:1rem}summary{cursor:pointer;color:#d7ccef;font-weight:600}
.mint{font:12px ui-monospace,monospace;overflow-wrap:anywhere;color:#aaa2bc}button{display:block;width:100%;font:inherit;font-weight:750;padding:1rem;border:0;border-radius:.75rem;background:#b4a3ff;color:#171125}button:disabled{opacity:.55}
#wallet-row{font-size:.84rem;margin:1.2rem 0}#status{font-size:.88rem;min-height:1.5rem}
#outcome[data-state="finalized"]{border-color:#4b9276;background:#192b28}#outcome[data-state="failed"]{border-color:#a5586e;background:#30202b}
a{display:inline-flex;align-items:center;justify-content:center;min-height:2.7rem;padding:.5rem .75rem;border:1px solid #8171b4;border-radius:.6rem;color:#e4d9ff;text-decoration:none;font-weight:650}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #e0ceff;outline-offset:3px}.receipt-actions{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.2rem}.receipt-actions a{flex:1}[hidden]{display:none!important}
</style>
<p class="eyebrow">Solana test network · funded.vip</p>
<h1 id="heading">Review trade</h1><p id="intro">Check the amounts, then approve the transaction in Phantom.</p>
<section class="card" id="review" hidden aria-label="Trade review">
<h2 id="trade-title">Trade</h2><div class="flow">
<div class="amount-block"><span class="label" id="sol-label">Estimated SOL to wallet</span><strong class="amount" id="sol-amount"></strong><span class="subtle" id="sol-hint"></span></div>
<div class="arrow" aria-hidden="true">↓</div>
<div class="amount-block"><span class="label" id="token-label">Token and quantity</span><strong class="amount" id="token-amount"></strong><span class="subtle" id="token-name"></span></div></div>
<hr class="divider"><div class="detail-grid"><span id="limit-label">After slippage</span><strong id="limit-amount"></strong></div>
<details><summary>Fees and token details</summary><div class="detail-grid" style="margin-top:1rem"><span>App fee</span><strong id="app-fee"></strong><span>Token mint</span><code class="mint" id="mint"></code></div><p class="subtle" id="fee-note"></p></details></section>
<section class="card" id="outcome" hidden aria-live="polite"><h2 id="outcome-title">test network result</h2>
<div id="receipt-amounts" class="flow" hidden>
<div class="amount-block"><span class="label" id="receipt-sol-label"></span><strong class="amount" id="receipt-sol"></strong></div>
<div class="arrow" aria-hidden="true">↓</div>
<div class="amount-block"><span class="label" id="receipt-token-label"></span><strong class="amount" id="receipt-token"></strong></div></div>
<p id="outcome-detail"></p><p id="slot-row" class="subtle" hidden></p>
<div class="receipt-actions"><a id="explorer" target="_blank" rel="noopener noreferrer" hidden>View on Solana Explorer ↗</a></div></section>
<p id="wallet-row">Wallet: <code class="mint" id="wallet">Loading…</code></p>
<button id="sign" disabled>Review in Phantom</button><p id="status" role="status">Loading trade…</p>
<script nonce="${nonce}" src="/api/mobile-wallet/web3.js"></script><script nonce="${nonce}">
const id='${id}',status=document.querySelector('#status'),button=document.querySelector('#sign');
let request,pollTimer;
const number=(value,digits=9)=>Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
function units(raw,decimals){let value=BigInt(raw),negative=value<0n;if(negative)value=-value;const scale=10n**BigInt(decimals),whole=(value/scale).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,','),fraction=(value%scale).toString().padStart(decimals,'0').replace(/0+$/,'');return (negative?'-':'+')+whole+(fraction?'.'+fraction:'');}
function showReview(summary){
 if(!summary)throw new Error('Trade details are unavailable. Refresh the desktop tab and start a new trade.');
 if(summary.kind==='launch'){
  document.querySelector('#heading').textContent='Review coin launch';
  document.querySelector('#intro').textContent='Approve the coin creation and community vault funding together in Phantom.';
  document.querySelector('#review').hidden=false;
  document.querySelector('#trade-title').textContent='Launch '+summary.tokenSymbol;
  document.querySelector('#sol-label').textContent='Estimated SOL for reserve buy';
  document.querySelector('#sol-amount').textContent=number(summary.expectedSol)+' SOL';
  document.querySelector('#sol-hint').textContent='Launch rent and network fees are additional.';
  document.querySelector('#token-label').textContent='Tokens sent to reward vault';
  document.querySelector('#token-amount').textContent=number(summary.reserveTokens)+' '+summary.tokenSymbol;
  document.querySelector('#token-name').textContent=summary.tokenName;
  document.querySelector('#limit-label').textContent='Maximum reserve buy';
  document.querySelector('#limit-amount').textContent=number(summary.maximumSol)+' SOL';
  document.querySelector('#app-fee').textContent='Included in the launch quote';
  document.querySelector('#mint').textContent=summary.mint;
  document.querySelector('#fee-note').textContent='Reward vault: '+summary.vault+'. Claims open only after a verified migration snapshot.';
  button.textContent='Approve Launch in Phantom';
  return;
 }
 const sell=summary.side==='sell',symbol=summary.tokenSymbol;
 document.querySelector('#review').hidden=false;
 document.querySelector('#trade-title').textContent=(sell?'Sell ':'Buy ')+symbol;
 document.querySelector('#sol-label').textContent=sell?'Estimated SOL received':'Estimated SOL to pay';
 document.querySelector('#sol-amount').textContent=number(sell?summary.expectedSol:summary.targetTotalSol)+' SOL';
 document.querySelector('#sol-hint').textContent=sell?'After app fee, before network fee':'Includes '+number(summary.appFeeSol)+' SOL app fee';
 document.querySelector('#token-label').textContent=sell?'Tokens to sell':'Estimated tokens received';
 document.querySelector('#token-amount').textContent=number(summary.tokenAmount)+' '+symbol;
 document.querySelector('#token-name').textContent=summary.tokenName;
 document.querySelector('#limit-label').textContent=sell?'Minimum SOL received':'Maximum SOL to pay';
 document.querySelector('#limit-amount').textContent=number(sell?summary.minimumSol:summary.maximumTotalSol)+' SOL';
 document.querySelector('#app-fee').textContent=number(summary.appFeeSol)+' SOL';
 document.querySelector('#mint').textContent=summary.mint;
 document.querySelector('#fee-note').textContent=sell?'App fee is deducted from SOL received. Network fees are additional.':'App fee is included in the shown totals. Network and account fees are additional.';
 button.textContent=sell?'Approve Sell in Phantom':'Approve Buy in Phantom';
}
function showOutcome(result){
 const state=result.status,panel=document.querySelector('#outcome'),summary=request?.summary,side=summary?.side;
 const setText=(selector,value)=>{document.querySelector(selector).textContent=value;};
 panel.hidden=false;panel.dataset.state=state;
 document.querySelector('#review').hidden=true;document.querySelector('#wallet-row').hidden=true;button.hidden=true;
 const link=document.querySelector('#explorer');
 if(result.signature){link.href='https://explorer.solana.com/tx/'+encodeURIComponent(result.signature)+'?cluster=devnet';link.hidden=false;}
 if(state==='finalized'){
  if(summary?.kind==='launch'){
   setText('#heading','Launch finalized');setText('#intro','Confirmed on Solana test network. The desktop tab verifies the vault and registers the launch.');
   setText('#outcome-title',summary.tokenSymbol+' created');
   setText('#receipt-sol-label','Wallet SOL change, including fees');setText('#receipt-sol',units(result.solDeltaLamports,9)+' SOL');
   setText('#receipt-token-label','Community reserve');setText('#receipt-token',number(summary.reserveTokens)+' '+summary.tokenSymbol+' sent to vault');
   document.querySelector('#receipt-amounts').hidden=false;
   setText('#outcome-detail','Check the desktop tab for the final vault receipt.');
   if(result.slot!=null){document.querySelector('#slot-row').hidden=false;setText('#slot-row','test network slot '+result.slot);}
   status.hidden=true;clearInterval(pollTimer);window.scrollTo(0,0);return;
  }
  setText('#heading','Trade complete');setText('#intro','Confirmed on Solana test network.');
  setText('#outcome-title',(side==='sell'?'Sold ':'Bought ')+(summary?.tokenSymbol||'tokens'));
  const solRaw=BigInt(result.solDeltaLamports),solChange=units(result.solDeltaLamports,9);
  const directional=(side==='buy'&&solRaw<0n)||(side==='sell'&&solRaw>0n);
  setText('#receipt-sol-label',side==='buy'&&solRaw<0n?'SOL paid, including fees':side==='sell'&&solRaw>0n?'SOL received, after fees':'Wallet SOL change');
  setText('#receipt-sol',(directional?solChange.slice(1):solChange)+' SOL');
  const tokenRaw=result.tokenDeltaRaw!=null?BigInt(result.tokenDeltaRaw):null;
  if(tokenRaw!=null&&Number.isInteger(result.tokenDecimals)){
   const tokenChange=units(result.tokenDeltaRaw,result.tokenDecimals);
   const tokenDirectional=(side==='buy'&&tokenRaw>0n)||(side==='sell'&&tokenRaw<0n);
   setText('#receipt-token-label',side==='buy'&&tokenRaw>0n?'Tokens received':side==='sell'&&tokenRaw<0n?'Tokens sold':'Token change');
   setText('#receipt-token',(tokenDirectional?tokenChange.slice(1):tokenChange)+' '+(summary?.tokenSymbol||'tokens'));
  }else{setText('#receipt-token-label','Token amount');setText('#receipt-token','See transaction details');}
  document.querySelector('#receipt-amounts').hidden=false;
  setText('#outcome-detail','Actual wallet balance changes from the finalized transaction.');
  if(result.slot!=null){document.querySelector('#slot-row').hidden=false;setText('#slot-row','test network slot '+result.slot);}
  status.hidden=true;clearInterval(pollTimer);window.scrollTo(0,0);
 }else if(state==='failed'){
  setText('#heading','Trade failed');setText('#intro','The test network transaction did not settle.');
  setText('#outcome-title','Transaction failed');setText('#outcome-detail',result.error||'Check the desktop tab for details.');
  document.querySelector('#receipt-amounts').hidden=true;status.hidden=true;clearInterval(pollTimer);window.scrollTo(0,0);
 }else{
  setText('#heading',state==='submitted'?'Trade submitted':'Trade signed');
  setText('#intro',state==='submitted'?'Checking the final test network result.':'Waiting for the desktop tab to submit.');
  setText('#outcome-title',state==='submitted'?'Waiting for confirmation':'Signature received');
  setText('#outcome-detail',state==='submitted'?'Your transaction was sent to Solana test network.':'Keep the desktop tab open while the trade is submitted.');
  status.hidden=true;window.scrollTo(0,0);
 }
}
async function pollStatus(){try{const response=await fetch('/api/mobile-wallet/trade-status/'+id,{cache:'no-store'});if(!response.ok)throw new Error('Status expired. Check the desktop tab or Solana Explorer.');showOutcome(await response.json());}catch(error){status.textContent=error.message||'Could not check test network status.';}}
fetch('/api/mobile-wallet/trade-request/'+id,{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Wallet request expired. Start again on the desktop.');request=await response.json();if(!window.solanaWeb3?.Transaction)throw new Error('Transaction decoder did not load. Reload this page.');document.querySelector('#wallet').textContent=request.publicKey;showReview(request.summary);button.disabled=false;status.textContent='Review the amounts and wallet, then approve in Phantom.'}).catch(error=>status.textContent=error.message);
button.addEventListener('click',async()=>{button.disabled=true;try{const provider=window.phantom?.solana||window.solana;if(!provider?.signTransaction)throw new Error('Open this page inside Phantom on your phone.');const connected=await provider.connect();const address=String(connected?.publicKey||provider.publicKey||'');if(address!==request.publicKey)throw new Error('Wrong wallet selected. Switch Phantom to '+request.publicKey+' and try again.');status.textContent='Refreshing the test network transaction before approval…';const refreshed=await fetch('/api/mobile-wallet/trade-refresh/'+id,{method:'POST'});if(!refreshed.ok)throw new Error((await refreshed.json()).error||'Could not refresh the transaction. Start again on the desktop.');const current=await refreshed.json();const bytes=Uint8Array.from(atob(current.transaction),character=>character.charCodeAt(0));const transaction=request.summary?.kind==='launch'?window.solanaWeb3.VersionedTransaction.deserialize(bytes):window.solanaWeb3.Transaction.from(bytes);status.textContent='Review the transaction in Phantom…';const signed=await provider.signTransaction(transaction);const signedBytes=signed.serialize();const encoded=btoa(Array.from(signedBytes,byte=>String.fromCharCode(byte)).join(''));const response=await fetch('/api/mobile-wallet/trade/'+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transaction:encoded})});if(!response.ok)throw new Error((await response.json()).error||'Could not return the signed transaction to the desktop.');button.hidden=true;status.textContent='Signature received. Waiting for test network submission and finalization…';await pollStatus();if(!['finalized','failed'].includes(document.querySelector('#outcome').dataset.state))pollTimer=setInterval(pollStatus,2000);}catch(error){status.textContent=error.message||'Signing failed.';button.disabled=false}});
</script></html>`;
  return { html, nonce };
}
