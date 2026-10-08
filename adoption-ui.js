import { apiRequest } from './client.js';
import { readLaunchJournal, recordLaunchEvent, policyMatchesJournal } from './launch-journal.js';
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
