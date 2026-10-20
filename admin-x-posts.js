export function initAdminXPosts({api,post,show}){
  const workspace=document.getElementById('workspace');if(!workspace)return;
  const panel=document.createElement('section');panel.className='panel';
  panel.innerHTML='<h2>X publishing review</h2><p>Publishing stays paused while the account is suspended. Approving content does not publish it or resume a worker. Daily summaries cover recorded payout receipts; individual payments stay on funded.vip.</p><p data-x-status role="status">Sign in to load publishing status.</p><div class="actions"><button type="button" data-x-load>Refresh review queue</button><button type="button" data-x-pause>Keep publishing paused</button></div><div data-x-events></div>';
  workspace.prepend(panel);
  const status=panel.querySelector('[data-x-status]'),list=panel.querySelector('[data-x-events]');let loading=false;
  async function load(){
    if(loading)return;loading=true;
    try{
      const data=await api('/api/admin/x-posts');
      status.textContent=`${data.safety.paused?'Paused':'Active'} · ${data.safety.reason} · every post needs review; approval expires after 24 hours.`;
      list.replaceChildren();
      if(!data.events.length){list.textContent='No pending posts to review.';return;}
      for(const row of data.events){
        const article=document.createElement('article');article.className='panel';
        const title=document.createElement('h3');title.textContent=row.event.kind.replaceAll('_',' ');
        const text=document.createElement('p');text.style.whiteSpace='pre-wrap';text.textContent=row.event.text;
        const evidence=document.createElement('details'),summary=document.createElement('summary'),proof=document.createElement('pre');
        summary.textContent='Source evidence and exact content hash';proof.style.whiteSpace='pre-wrap';proof.style.overflowWrap='anywhere';
        proof.textContent=JSON.stringify({hash:row.hash,proofs:row.event.proofs,review:row.review,hold:row.reason},null,2);evidence.append(summary,proof);
        const form=document.createElement('form'),label=document.createElement('label'),reason=document.createElement('input');
        label.textContent='Review reason';reason.required=true;reason.minLength=10;reason.maxLength=500;label.append(reason);
        const approve=document.createElement('button'),reject=document.createElement('button');
        approve.type='submit';approve.textContent='Approve exact text';reject.type='button';reject.textContent='Reject';
        async function decide(decision){
          if(!form.reportValidity())return;
          if(!confirm(`${decision==='approved'?'Approve':'Reject'} this exact post? This does not publish it or resume posting.`))return;
          approve.disabled=reject.disabled=true;
          try{await post('/api/admin/x-posts/review',{id:row.event.id,expectedHash:row.hash,decision,reason:reason.value});show('Review saved. No post was sent.');await load();}
          catch(error){show(error.message,true);}finally{approve.disabled=reject.disabled=false;}
        }
        form.addEventListener('submit',event=>{event.preventDefault();void decide('approved');});
        reject.addEventListener('click',()=>{void decide('rejected');});
        form.append(label,approve,reject);article.append(title,text,evidence,form);list.append(article);
      }
    }catch(error){status.textContent='Publishing review unavailable. No posts were sent.';show(error.message,true);}
    finally{loading=false;}
  }
  panel.querySelector('[data-x-load]').addEventListener('click',()=>{void load();});
  panel.querySelector('[data-x-pause]').addEventListener('click',()=>{void(async()=>{
    try{await post('/api/admin/x-posts/pause',{});await load();show('Publishing pause saved.');}catch(error){show(error.message,true);}
  })();});
  new MutationObserver(()=>{if(!workspace.hidden)void load();}).observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if(!workspace.hidden)void load();
}
