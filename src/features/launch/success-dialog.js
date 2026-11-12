import { appendLaunchKit } from '../growth/launch-assist.js';
import { openShareComposer } from '../../../share-tools.js';
// Called only after the launch's on-chain reserve, fee route and policy verification.
export function showLaunchSuccess({ mint, name, symbol, signature, registered }, document = globalThis.document) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '') || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature || '')) return;
  document.getElementById('launch-success-dialog')?.remove();
  const priorFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.id = 'launch-success-dialog'; dialog.className = 'launch-success-dialog';
  dialog.setAttribute('aria-labelledby', 'launch-success-title');
  dialog.setAttribute('aria-describedby', 'launch-success-description');
  dialog.innerHTML = '<span class="launch-success-icon" aria-hidden="true">✓</span><h2 id="launch-success-title">Token created successfully</h2><p id="launch-success-description"></p><p class="launch-success-registration"></p><div class="launch-success-actions"><a class="primary-button" data-open-token>Open token page →</a><a data-launch-receipt target="_blank" rel="noopener noreferrer">View Solana receipt ↗</a><button type="button" class="secondary-button" data-share-launch>Share launch</button><button type="button" class="secondary-button" data-close-launch>Close</button></div>';
  dialog.querySelector('#launch-success-description').textContent = `${name} (${symbol}) is confirmed on Solana.`;
  const pending = dialog.querySelector('.launch-success-registration');
  pending.hidden = registered === true;
  pending.textContent = 'The coin is created. Directory registration is still pending; check Portfolio before attempting another launch.';
  dialog.querySelector('[data-open-token]').href = `/token/${encodeURIComponent(mint)}`;
  dialog.querySelector('[data-launch-receipt]').href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'}`;
  dialog.querySelector('[data-close-launch]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.remove(); if (priorFocus?.isConnected) priorFocus.focus({ preventScroll:true }); });
  const share=dialog.querySelector('[data-share-launch]');
  share.disabled=registered!==true;
  share.title=registered===true?'Review your launch card and message':'Sharing becomes available after directory registration';
  const devnet = import.meta.env?.VITE_SOLANA_CLUSTER !== 'mainnet-beta';
  share.addEventListener('click',async()=>{
    dialog.close();
    const url=new URL(`/token/${mint}`,globalThis.location.origin).href;
    const fallback={kind:'launch',verified:true,mint,name,symbol,receipt:signature,network:devnet?'devnet':'mainnet-beta',receiptUrl:`https://explorer.solana.com/tx/${signature}${devnet?'?cluster=devnet':''}`};
    // Live banner with the coin's own image (stored on this origin for Devnet launches).
    const banner=await import('../listing/listing-share.js').then(module=>module.tokenBannerResult(mint,{symbol,name,tag:'Just launched',
      logoUrl:devnet?`/devnet-images/${encodeURIComponent(mint)}`:'',tagline:'Fresh on Solana · join the community early\nLive chart, trades and holders on richpad.fun'})).catch(()=>null);
    const { launchShareText } = await import('../listing/listing-share.js').catch(()=>({}));
    openShareComposer({kind:'launch',title:`${name} ($${symbol})`,network:devnet?'Solana Devnet · test funds':'Solana',
      text:launchShareText?launchShareText({symbol,name,mint,devnet}):`${name} ($${symbol}) just launched on richpad.fun. CA: ${mint}`,
      url,result:banner?.result||fallback});
  });
  appendLaunchKit(dialog, { mint, name, symbol }, document);
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector('[data-open-token]').focus();
}
