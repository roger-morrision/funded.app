import { activityRows, filterActivity, isActivityHidden } from './activity-model.js';
import { panel, el, link, button, array, utc } from './view-utils.js';
import { receiptUrl } from './receipt-inspector.js';
import { productEvent } from '../../../product-events.js';
let latestExperience = null;
globalThis.addEventListener?.('funded:financial-experience',event=>{latestExperience=event.detail;});
export function initializeActivityFeed(app) {
  const board = document.querySelector('.home-launch-board'); if (!board) return;
  const root = panel('personal-activity-feed','Your activity feed','Follow creators and wallets, inspect verified receipts, or browse observed trades. Activity coverage can be partial.');
  root.dataset.workspaceRoute='overview';board.before(root);
  const controls=el('div',null,'flow-tabs'),status=el('p'),list=el('div'),fresh=button('Show new updates',()=>apply());fresh.hidden=true;status.setAttribute('role','status');
  const kinds=[['all','All recorded'],['following','Following'],['launch','Launches'],['statement','Creator updates'],['receipt','Receipts'],['trade','Observed trades']];
  let kind='all',rows=[],pending=[],statements=[],limit=12,busy=false,unavailable=[];
  const more=button('Show more activity',()=>{limit+=12;render();});
  for (const [key,title] of kinds) {const action=button(title,()=>{kind=key;limit=12;const url=new URL(location.href);url.searchParams.set('activity',key);history.pushState({},'',url);render();if(key==='following')productEvent('feed_following_view');});action.dataset.activityKind=key;controls.append(action);}
  root.append(controls,fresh,button('Refresh feed',()=>void refresh()),status,list,more);
  function render() {
    for(const action of controls.children)action.setAttribute('aria-pressed',String(action.dataset.activityKind===kind));
    let ids=[];try{ids=array(JSON.parse(localStorage.getItem('funded.creator.following') || '[]'));}catch{}
    const selected=filterActivity(rows,kind,new Set(app.getFollowedWallets().map(row=>row.address)),new Set(ids.map(String)));
    // Explicit refresh/filter actions own row replacement; passive updates stay buffered.
    list.replaceChildren();for(const row of selected.slice(0,limit)){
      const item=el('article',null,'flow-activity-row');item.append(el('small',`${row.evidence} · ${utc(row.at)}`),el('h3',row.title));
      if(row.text)item.append(el('p',row.text));
      if(row.creator)item.append(link(`Wallet ${row.creator.slice(0,6)}…`,`/wallet/${row.creator}`));
      item.append(link(row.signature?'Inspect exact event':'Open details',row.signature?receiptUrl(row.signature,row.mint,row.wallet):row.href));list.append(item);
    }
    status.textContent=`${selected.length} matching records${unavailable.length ? ' · Unavailable: '+unavailable.join(', ') : ''}. ${kind==='following'&&!selected.length?'Follow a creator or wallet to build this view.':'Use Show new updates to apply incoming activity.'}`;
    if(!selected.length)list.append(el('p','No matching recorded activity in the loaded coverage.'));more.hidden=selected.length<=limit;
  }
  function collect(){let trades=[];try{trades=app.collectRecentTrades(app.assets,{limit:50,since:Math.floor(Date.now()/1000)-86400});}catch{}
    return activityRows(app.verifiedLaunchPolicies,latestExperience,trades,statements).filter(row=>!isActivityHidden(row));}
  function buffer(){const next=collect();if(!rows.length){pending=next;apply();return;}pending=next;const count=next.filter(row=>!rows.some(old=>old.id===row.id)).length;fresh.hidden=!count;fresh.textContent=`Show ${count} new updates`;}
  function apply(){rows=pending.length?pending:collect();pending=[];fresh.hidden=true;render();window.dispatchEvent(new CustomEvent('funded:feed-data',{detail:rows}));}
  async function refresh(){if(busy||!document.body.classList.contains('page-route-overview'))return;busy=true;
    const read=path=>app.apiRequest(path,{signal:AbortSignal.timeout(15000)}).catch(()=>null);
    const cached=latestExperience?.cluster==='devnet'&&Date.now()-Date.parse(latestExperience.generatedAt)<60000;
    const [experience,content]=await Promise.all([cached?Promise.resolve({available:true,data:latestExperience}):read('/api/rewards/experience'),read('/api/financial/activity')]);
    unavailable=[];if(experience?.available)latestExperience=experience.data;else unavailable.push('receipt feed');
    if(content?.available&&content.data?.cluster==='devnet')statements=array(content.data.statements);else unavailable.push('creator updates');
    pending=collect();apply();busy=false;
  }
  for(const name of ['funded:financial-experience','funded:following','funded:following-changed','funded:token-list-markets'])window.addEventListener(name,()=>{if(name==='funded:financial-experience')buffer();else if(name.includes('following'))render();else buffer();});
  window.addEventListener('popstate',()=>{const requested=new URL(location.href).searchParams.get('activity');kind=kinds.some(([key])=>key===requested)?requested:'all';render();});
  document.addEventListener('funded:token-list-markets',buffer);
  window.addEventListener('funded:content-preferences',()=>{pending=collect();apply();});
  window.addEventListener('funded:route-change',()=>{if(document.body.classList.contains('page-route-overview'))void refresh();});
  const requested=new URL(location.href).searchParams.get('activity');if(kinds.some(([key])=>key===requested))kind=requested;
  void refresh();
}
