export function initAdminRpcHealth({api,document=globalThis.document}){
 const workspace=document.querySelector('#workspace'),anchor=document.querySelector('#financial-health')?.closest('section');
 if(!workspace||!anchor)return{refresh:async()=>{}};
 const panel=document.createElement('section');panel.className='panel';
 panel.innerHTML='<div class="section-head"><div><h2>RPC gateway and Redis</h2><p>Connection health and request savings since the gateway last restarted.</p></div><button type="button">Refresh RPC health</button></div><div data-rpc-health role="status">Sign in to load gateway health.</div>';
 anchor.after(panel);const root=panel.querySelector('[data-rpc-health]'),button=panel.querySelector('button');let generation=0;
 async function refresh(){
  if(workspace.hidden)return;const token=++generation;button.disabled=true;
  try{
   const data=await api('/api/admin/rpc-health');if(token!==generation||workspace.hidden)return;
   root.replaceChildren();const summary=document.createElement('p');
   if(!data.enabled){summary.textContent='The shared RPC gateway is disabled.';root.append(summary);return;}
   summary.textContent=`${data.verified?'Devnet verified':'Devnet verification unavailable'} · Redis ${data.redis.ready?'ready':data.redis.enabled?'unavailable':'disabled'} · checked ${data.checkedAt}`;root.append(summary);
   const fields=[['Provider requests',data.counts.upstreamRequests],['Redis requests saved',data.counts.redisCacheHits],['Memory requests saved',data.memoryCacheHits],
    ['Coalesced reads',data.counts.coalescedReads],['Account requests batched',data.counts.accountBatchSavings],['Total requests avoided',data.avoidedProviderAttempts],
    ['Provider rate limits',data.counts.rateLimited],['Queue rejections',data.counts.queueRejected]];
   const grid=document.createElement('dl');grid.className='gate-grid';
   for(const [name,value]of fields){const item=document.createElement('div'),label=document.createElement('dt'),count=document.createElement('dd');label.textContent=name;count.textContent=Number(value).toLocaleString();item.append(label,count);grid.append(item);}root.append(grid);
   const note=document.createElement('p');note.textContent=data.scope;root.append(note);
  }catch{if(token===generation&&!workspace.hidden)root.textContent='RPC health is unavailable. Refresh to retry.';}
  finally{if(token===generation)button.disabled=false;}
 }
 button.addEventListener('click',()=>{void refresh();});
 new MutationObserver(()=>{if(workspace.hidden){generation++;root.textContent='Sign in to load gateway health.';button.disabled=false;}})
  .observe(workspace,{attributes:true,attributeFilter:['hidden']});
 return{refresh};
}
