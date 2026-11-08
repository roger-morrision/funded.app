import {activeBoostPackages} from '../../../boost-offer.js';
import {featuredMetrics} from './featured-metrics.js';
import {marketFacts} from '../explore/market-facts.js';
import {createFeaturedScroller} from './featured-view.js';

export function initializeFeaturedTokens(appState) {
  const root=document.querySelector('.home-featured');if(!root)return;
  const scroller=createFeaturedScroller(root),status=root.querySelector('[data-featured-status]');
  let items=[],pending,expiryTimer;
  const updateMetrics=()=>{
    const assets=new Map((appState.assets||[]).map(asset=>[asset.address,asset]));
    scroller.updateMetrics(new Map(items.map(item=>{
      const policy=appState.verifiedLaunchPolicyForMint(item.mint);
      const token={...item,createdAt:item.createdAt??(policy?.blockTime?Number(policy.blockTime)*1000:null)};
      return [item.mint,featuredMetrics(token,{asset:marketFacts(assets.get(item.mint)||{address:item.mint},appState.EXPLORE_CLUSTER),
        holderSnapshot:appState.homeHolderCountCache.get(item.mint),solUsd:appState.coinSolUsdPrice,cluster:appState.EXPLORE_CLUSTER})];
    })));
  };
  const render=()=>{
    items=items.filter(item=>item.expiresAt>Date.now());
    scroller.render(items,appState.EXPLORE_CLUSTER);
    updateMetrics();
    if(!items.length){status.hidden=false;status.textContent='Your token could be here. Paid promotions and listings appear for 48 hours.';}
    clearTimeout(expiryTimer);
    if(items.length){
      const deadlines=items.flatMap(item=>[item.expiresAt,...activeBoostPackages(item.boost).map(pack=>Date.parse(pack.expiresAt))]);
      expiryTimer=setTimeout(render,Math.max(10,Math.min(...deadlines)-Date.now()+10));
    }
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
  for(const name of ['funded:token-list-markets','funded:verified-search-index','funded:holders-updated'])document.addEventListener(name,updateMetrics);
  for(const name of ['funded:listing-verified','funded:boost-verified'])window.addEventListener(name,()=>poller.refresh());
}
