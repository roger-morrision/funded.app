import {createFeaturedScroller} from './featured-view.js';

export function initializeFeaturedTokens(appState) {
  const root=document.querySelector('.home-featured');if(!root)return;
  const scroller=createFeaturedScroller(root),status=root.querySelector('[data-featured-status]');
  let items=[],pending,expiryTimer;
  const render=()=>{
    items=items.filter(item=>item.expiresAt>Date.now());
    scroller.render(items,appState.EXPLORE_CLUSTER);
    if(!items.length){status.hidden=false;status.textContent='Your token could be here. Paid promotions and listings appear for 48 hours.';}
    clearTimeout(expiryTimer);
    if(items.length)expiryTimer=setTimeout(render,Math.min(...items.map(item=>item.expiresAt))-Date.now()+10);
  };
  const refresh=signal=>{
    if(pending)return pending;
    pending=(async()=>{
      try{
        const response=await appState.apiRequest('/api/home/featured',{signal});
        signal?.throwIfAborted();
        if(!response.available||response.data?.cluster!==appState.EXPLORE_CLUSTER||!Array.isArray(response.data.items))throw Error('Featured data unavailable');
        items=response.data.items;render();
        status.hidden=items.length>0;
        status.textContent=items.length?'':'Your token could be here. Paid promotions and listings appear for 48 hours.';
      }catch(error){
        if(signal?.aborted)return;
        render();status.hidden=false;
        status.textContent=items.length?'Showing previously verified placements. Refreshing shortly.':'Featured tokens are temporarily unavailable. Retrying shortly.';
      }finally{pending=null;}
    })();return pending;
  };
  const poller=appState.createRoutePoller({run:refresh,active:()=>appState.requestedPageRoute()==='overview',intervalMs:60_000});
  if(appState.requestedPageRoute()==='overview')void refresh();
  for(const name of ['funded:listing-verified','funded:boost-verified'])window.addEventListener(name,()=>poller.refresh());
}
