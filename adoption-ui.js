import { apiRequest } from './client.js';
import { PRODUCT_EVENTS, productCounterExport } from './product-events.js';
import { readLaunchJournal, recordLaunchEvent, policyMatchesJournal, journalRecovery } from './launch-journal.js';
const $ = selector => document.querySelector(selector);

const imageTools=document.createElement('div');imageTools.className='adoption-tools image-picker-actions';
imageTools.innerHTML='<button type="button" id="image-upload" aria-label="Upload token image" title="Upload image"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5"/></svg></button><button type="button" id="image-remove" aria-label="Delete token image" title="Delete image" disabled><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button><p id="image-preparation-status" class="sr-only" role="status" aria-live="polite">No image selected.</p>';
const imageInput=$('#token-image');$('#token-image-picker')?.append(imageTools);
$('#image-upload').onclick=event=>{event.preventDefault();event.stopPropagation();imageInput.click();};
$('#image-remove').onclick=event=>{event.preventDefault();event.stopPropagation();imageInput.value='';imageInput.dispatchEvent(new Event('change',{bubbles:true}));};

async function reconcileRegisteredLaunches(){
  try {
    const response=await apiRequest('/api/launches');
    if(!response.available||!Array.isArray(response.data))return;
    for(const row of readLaunchJournal()) {
      if(!['unknown','confirmed','verification-pending','registration-pending'].includes(row.state)||!row.signature)continue;
      const registered=response.data.find(policy=>policy.pumpFeeRoute?.verified===true&&policyMatchesJournal(policy,row));
      if(registered)recordLaunchEvent(row.id,{state:'completed',mint:row.mint,signature:row.signature});
    }
  } catch { /* Keep uncertain local history when registry verification is unavailable. */ }
}
void reconcileRegisteredLaunches();

const recoveryHost = document.querySelector('#my-launches .portfolio-launches-heading');
if (recoveryHost) {
  const panel = document.createElement('section');
  panel.id = 'launch-recovery-panel';
  panel.className = 'role-panel';
  panel.setAttribute('aria-label', 'Unfinished launch receipts');
  const feedback = document.createElement('p');
  feedback.className = 'field-help';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  recoveryHost.after(panel, feedback);
  const launchSignature = row => row.events?.filter(event => event.step === 'launch' && event.signature).at(-1)?.signature
    || (['verification-pending', 'registration-pending'].includes(row.state) ? row.signature : null);
  const render = () => {
    const rows = readLaunchJournal().filter(row => row.cluster === 'devnet'
      && ['submitted', 'confirmed', 'unknown', 'verification-pending', 'registration-pending'].includes(row.state)
      && launchSignature(row));
    panel.hidden = rows.length === 0;
    panel.replaceChildren();
    if (!rows.length) return;
    const heading = document.createElement('h3');
    heading.textContent = 'Unfinished launch receipts';
    panel.append(heading);
    for (const row of rows) {
      const signature = launchSignature(row);
      const item = document.createElement('div');
      item.className = 'projects-empty-content';
      const title = document.createElement('strong');
      title.textContent = `${row.name || 'Solana coin'} (${row.symbol || 'TOKEN'})`;
      const detail = document.createElement('p');
      detail.textContent = journalRecovery(row);
      const receipt = document.createElement('a');
      receipt.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'}`;
      receipt.target = '_blank'; receipt.rel = 'noopener noreferrer';
      receipt.textContent = 'Check original transaction ↗';
      item.append(title, detail, receipt);
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(`funded.launch.${row.mint}`) || 'null'); } catch { /* Keep the original receipt visible. */ }
      if (saved?.mint === row.mint && saved.creatorWallet === row.payer) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'secondary-button';
        button.textContent = 'Verify and register existing launch';
        button.addEventListener('click', () => {
          button.disabled = true;
          feedback.textContent = 'Checking the original launch. No coin transaction will be sent.';
          window.dispatchEvent(new CustomEvent('funded:recover-registration',
            { detail:{ id:row.id, mint:row.mint } }));
        });
        item.append(button);
      } else {
        const missing = document.createElement('p');
        missing.className = 'field-help';
        missing.textContent = 'Saved registration details are unavailable on this device. Keep the receipt; do not create another coin.';
        item.append(missing);
      }
      panel.append(item);
    }
  };
  window.addEventListener('funded:journal', render);
  window.addEventListener('funded:recovery-result', event => {
    feedback.textContent = String(event.detail || 'Recovery is still pending.');
    feedback.hidden = false;
    render();
  });
  render();
}
