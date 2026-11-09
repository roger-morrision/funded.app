import {developerLockDisplay,walletDeveloperLocks} from './developer-lock-display.js';

export function mountLockedTokens(app,{document=globalThis.document,window=globalThis.window}={}) {
  const tabs=document.querySelector('.portfolio-view-tabs');if(!tabs)return;
  const button=document.createElement('button');button.type='button';button.id='portfolio-locked-tab';
  button.dataset.portfolioTab='locked';button.setAttribute('role','tab');button.setAttribute('aria-selected','false');
  button.setAttribute('aria-controls','portfolio-locked-panel');button.tabIndex=-1;button.textContent='Locked tokens';
  const panel=document.createElement('section');panel.id='portfolio-locked-panel';panel.className='portfolio-tab-panel portfolio-saved-panel';
  panel.hidden=true;panel.tabIndex=0;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
  tabs.append(button);tabs.parentElement.append(panel);
  const holdingsNote=document.createElement('p');holdingsNote.className='flow-note';
  holdingsNote.textContent='Holdings lists spendable wallet tokens. Developer tokens held in escrow appear in the Locked tokens tab.';
  document.querySelector('#portfolio-holding-rows')?.after(holdingsNote);
  let wallet=null,cluster=null,generation=0,loading=false,lastRead=0;
  const locks=new Map();
  const text=(tag,value)=>Object.assign(document.createElement(tag),{textContent:value});
  function render(){
    if(wallet!==app.connectedWalletAddress||cluster!==app.EXPLORE_CLUSTER){
      wallet=app.connectedWalletAddress;cluster=app.EXPLORE_CLUSTER;generation++;locks.clear();loading=false;lastRead=0;
    }
    panel.replaceChildren(text('h3','Locked developer tokens'),text('p','Developer buys held in escrow are separate from spendable wallet holdings. Claim them on the token page after their saved deadline.'));
    const refresh=document.createElement('button');refresh.type='button';refresh.className='secondary-button';
    refresh.textContent=loading?'Checking locks…':'Refresh locked tokens';refresh.disabled=loading;
    refresh.onclick=()=>{lastRead=0;void load();};panel.append(refresh);
    if(!wallet){panel.append(text('p','Connect your creator wallet to see its locked tokens.'));return;}
    const launches=walletDeveloperLocks(app.verifiedLaunchPolicies,wallet,cluster);
    if(!launches.length){panel.append(text('p',app.verifiedLaunchPoliciesStatus==='ready'?'No developer token locks found for this wallet.':'Launch records are loading or unavailable. Refresh to retry.'));return;}
    for(const launch of launches){
      const live=locks.get(launch.mint),lock=live||{...launch.developerTokenLock,verified:false};
      const info=developerLockDisplay(lock),card=document.createElement('article');card.className='portfolio-locked-card';
      const link=document.createElement('a');link.href=`/token/${encodeURIComponent(launch.mint)}`;link.textContent=`${launch.symbol||launch.name||'Token'} · ${info.state}`;
      card.append(link,text('p',info.amount?`${info.amount} ${launch.symbol||'tokens'} · original developer allocation`:'Amount verification pending'),
        text('p',`Release time: ${info.release}`),text('p',info.timing));
      if(!live?.verified)card.append(text('small','Saved launch schedule shown. Current escrow balance has not been verified.'));
      else card.append(text('small',info.state==='Released'?'Released tokens may now be in your wallet or have been transferred.':'Verified escrow custody; excluded from spendable holdings.'));
      panel.append(card);
    }
  }
  async function load(){
    render();if(!wallet||loading||Date.now()-lastRead<30000)return;
    loading=true;lastRead=Date.now();const id=generation,owner=wallet,network=cluster;
    const launches=walletDeveloperLocks(app.verifiedLaunchPolicies,owner,network);render();
    for(let offset=0;offset<launches.length;offset+=2){
      await Promise.all(launches.slice(offset,offset+2).map(async launch=>{
        let response;try{response=await app.apiRequest(`/api/tokens/${encodeURIComponent(launch.mint)}/launch-protection`,{signal:AbortSignal.timeout(20000)});}catch{}
        if(id!==generation||owner!==app.connectedWalletAddress||network!==app.EXPLORE_CLUSTER)return;
        const data=response?.available?response.data:null;
        locks.set(launch.mint,data?.mint===launch.mint&&data.cluster===network&&data.creatorWallet===owner&&data.tokenLock?.verified
          ?data.tokenLock:{...launch.developerTokenLock,verified:false});
      }));
      if(id!==generation||owner!==app.connectedWalletAddress||network!==app.EXPLORE_CLUSTER)return;
    }
    loading=false;render();
  }
  button.addEventListener('click',()=>{void load();});
  window.addEventListener('funded:reward-identity-change',()=>{render();if(!panel.hidden)void load();});
  document.addEventListener('funded:verified-search-index',()=>{lastRead=0;render();if(!panel.hidden)void load();});
  document.querySelector('#portfolio-refresh')?.addEventListener('click',()=>{lastRead=0;void load();});
  app.createRoutePoller({run:()=>load(),active:()=>!panel.hidden&&app.requestedPageRoute()==='my-launches',intervalMs:60000});
  render();return{render,load,panel};
}
