import {releaseDeveloperTokens,developerReleaseStorageKey} from '../../../developer-token-release.js';
export function initializeLaunchProtection(appState,{document=globalThis.document,window=globalThis.window}={}){
  let activeMint=null,generation=0,timer=null,latest=null,busy=false;
  // Keep recovery actions in the fees summary; release details live in Portfolio.
  const panel=document.createElement('div');panel.id='coin-developer-token-claim';panel.hidden=true;
  document.querySelector('#coin-summary-dashboard')?.append(panel);
  const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
  function render(data){
    panel.replaceChildren();panel.hidden=true;
    const lock=data.tokenLock||{};
    let pending=false;try{pending=Boolean(window.localStorage.getItem(developerReleaseStorageKey(activeMint,data.creatorWallet,lock.programId)));}catch{}
    if((lock.status==='claimable'&&!lock.automaticRelease?.healthy||pending)&&data.creatorWallet===appState.connectedWalletAddress){
      const claim=text('button',pending?'Verify token release':'Release manually (fallback)');claim.type='button';claim.className='secondary-button';claim.disabled=busy||!lock.verified;
      claim.onclick=async()=>{
        if(busy)return;busy=true;claim.disabled=true;const mint=activeMint,session=appState.captureWalletSession();
        try{if(!session||session.address!==data.creatorWallet)throw Error('Connect the original developer wallet.');
          const result=await releaseDeveloperTokens({connection:appState.connection,provider:session.provider,mint,creator:data.creatorWallet,
            amount:lock.amount,programId:lock.programId,assertCurrent:()=>appState.assertWalletSessionCurrent(session),storage:window.localStorage});
          appState.showToast(result.status==='finalized'?'Developer tokens released; token balance changes verified.':result.status==='failed'?'Release failed on-chain. Refresh before retrying.':'Release outcome is pending. Use Verify token release; do not sign again.');
        }catch(error){appState.showToast(error.message);}finally{busy=false;if(activeMint===mint)await refresh(false);}
      };panel.append(claim);panel.hidden=false;
    }
  }
  async function refresh(scan=false,polls=0){
    if(!activeMint)return;const mint=activeMint,id=generation;
    let response;try{response=await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/launch-protection${scan?'?scan=1':''}`);}catch{response={available:false};}
    if(id!==generation||activeMint!==mint)return;
    if(!response.available||response.data?.mint!==mint){
      if(latest?.tokenLock){latest={...latest,tokenLock:{...latest.tokenLock,verified:false,status:'unavailable'}};render(latest);}
      else{panel.hidden=true;panel.replaceChildren();}return;
    }
    latest=response.data;render(latest);window.clearTimeout(timer);
    if(latest.bundleDetection?.scanning&&polls<4)timer=window.setTimeout(()=>{void refresh(false,polls+1);},15000);
    else if(['locked','claimable'].includes(latest.tokenLock?.status))timer=window.setTimeout(()=>{void refresh(false);},30000);
  }
  window.addEventListener('funded:coin-facts',event=>{generation++;window.clearTimeout(timer);activeMint=event.detail?.launch?.mint||null;latest=null;panel.hidden=true;panel.replaceChildren();if(activeMint)void refresh(false);});
  window.addEventListener('hashchange',()=>{if(!appState.getCoinMintAddress?.()){generation++;activeMint=null;window.clearTimeout(timer);panel.hidden=true;}});
  window.addEventListener('funded:reward-identity-change',()=>{if(activeMint&&latest)render(latest);});
  return {refresh,render,panel};
}
