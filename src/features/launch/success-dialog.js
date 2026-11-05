// Called only after the launch's on-chain reserve, fee route and policy verification.
export function showLaunchSuccess({ mint, name, symbol, signature, registered }, document = globalThis.document) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '') || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature || '')) return;
  document.getElementById('launch-success-dialog')?.remove();
  const priorFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.id = 'launch-success-dialog'; dialog.className = 'launch-success-dialog';
  dialog.setAttribute('aria-labelledby', 'launch-success-title');
  dialog.setAttribute('aria-describedby', 'launch-success-description');
  dialog.innerHTML = '<span class="launch-success-icon" aria-hidden="true">✓</span><h2 id="launch-success-title">Token created successfully</h2><p id="launch-success-description"></p><p class="launch-success-registration"></p><div class="launch-success-actions"><a class="primary-button" data-open-token>Open token page →</a><a data-launch-receipt target="_blank" rel="noopener noreferrer">View Solana receipt ↗</a><button type="button" class="secondary-button">Close</button></div>';
  dialog.querySelector('#launch-success-description').textContent = `${name} (${symbol}) is confirmed on Solana.`;
  const pending = dialog.querySelector('.launch-success-registration');
  pending.hidden = registered === true;
  pending.textContent = 'The coin is created. Directory registration is still pending; check Portfolio before attempting another launch.';
  dialog.querySelector('[data-open-token]').href = `/token/${encodeURIComponent(mint)}`;
  dialog.querySelector('[data-launch-receipt]').href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.remove(); if (priorFocus?.isConnected) priorFocus.focus({ preventScroll:true }); });
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector('[data-open-token]').focus();
}
