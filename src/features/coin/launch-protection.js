import {releaseDeveloperTokens,developerReleaseStorageKey} from '../../../developer-token-release.js';
import './launch-protection.css';

const tokens=value=>{try{return (Number(BigInt(value))/1e6).toLocaleString(undefined,{maximumFractionDigits:6});}catch{return 'Unknown';}};
export function initializeLaunchProtection(appState,{document=globalThis.document,window=globalThis.window}={}){
  let activeMint=null,generation=0,timer=null,latest=null,busy=false;
  const panel=document.createElement('section');panel.id='coin-launch-protection';panel.className='launch-protection-panel';panel.dataset.launchProtection='';panel.hidden=true;
  document.querySelector('#coin-summary-dashboard')?.after(panel);
  const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
  const link=(label,kind,value)=>{const node=text('a',label);node.href=`https://explorer.solana.com/${kind}/${encodeURIComponent(value)}?cluster=devnet`;node.target='_blank';node.rel='noopener noreferrer';return node;};
  function render(data){
    panel.replaceChildren();panel.hidden=false;
    panel.append(text('h3','Developer tokens & launch risk'));
    const lock=data.tokenLock||{};
    const lockText=lock.verified&&['locked','claimable','released'].includes(lock.status)
      ? `${tokens(lock.amount)} developer tokens · ${lock.status==='locked'?'Locked':lock.status==='claimable'?'Ready to claim':'Released'}. Unlock time: ${new Date(lock.unlockAt*1000).toLocaleString()}.`
      : lock.status==='not-selected'?'No developer token purchase was made at launch.'
      : lock.status==='not-required-for-legacy-launch'?'This older launch has no required developer-token escrow.'
      : 'Developer token custody could not be verified. Refresh before signing.';
    panel.append(text('p',lockText),text('p','The token lock covers the declared initial developer purchase. Other wallets can still trade.'));
    if(lock.verified&&lock.lock){const proof=text('p','');proof.append(lock.fundingSignature?link('View lock transaction','tx',lock.fundingSignature):link('View lock account','address',lock.lock));panel.append(proof);}
    let pending=false;try{pending=Boolean(window.localStorage.getItem(developerReleaseStorageKey(activeMint,data.creatorWallet)));}catch{}
    if((lock.status==='claimable'||pending)&&data.creatorWallet===appState.connectedWalletAddress){
      const claim=text('button',pending?'Verify token release':'Claim unlocked developer tokens');claim.type='button';claim.disabled=busy||!lock.verified;
      claim.onclick=async()=>{
        if(busy)return;busy=true;claim.disabled=true;const mint=activeMint,session=appState.captureWalletSession();
        try{if(!session||session.address!==data.creatorWallet)throw Error('Connect the original developer wallet.');
          const result=await releaseDeveloperTokens({connection:appState.connection,provider:session.provider,mint,creator:data.creatorWallet,
            amount:lock.amount,assertCurrent:()=>appState.assertWalletSessionCurrent(session),storage:window.localStorage});
          appState.showToast(result.status==='finalized'?'Developer tokens released; token balance changes verified.':result.status==='failed'?'Release failed on-chain. Refresh before retrying.':'Release outcome is pending. Use Verify token release; do not sign again.');
        }catch(error){appState.showToast(error.message);}finally{busy=false;if(activeMint===mint)await refresh(false);}
      };panel.append(claim);
    }
    // Bundle-wallet signals were removed from the coin page by request.
  }
  async function refresh(scan=false,polls=0){
    if(!activeMint)return;const mint=activeMint,id=generation;
    let response;try{response=await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/launch-protection${scan?'?scan=1':''}`);}catch{response={available:false};}
    if(id!==generation||activeMint!==mint)return;
    if(!response.available||response.data?.mint!==mint){panel.hidden=false;panel.replaceChildren(text('h3','Developer tokens & launch risk'),text('p',response.data?.error||'Protection verification is unavailable. Refresh to retry.'));const retry=text('button','Refresh protection');retry.type='button';retry.onclick=()=>{void refresh(false);};panel.append(retry);return;}
    latest=response.data;render(latest);window.clearTimeout(timer);
    if(latest.bundleDetection?.scanning&&polls<4)timer=window.setTimeout(()=>{void refresh(false,polls+1);},15000);
  }
  window.addEventListener('funded:coin-facts',event=>{generation++;window.clearTimeout(timer);activeMint=event.detail?.launch?.mint||null;latest=null;panel.hidden=!activeMint;if(activeMint){panel.replaceChildren(text('p','Checking launch protection…'));void refresh(false);}});
  window.addEventListener('hashchange',()=>{if(!appState.getCoinMintAddress?.()){generation++;activeMint=null;window.clearTimeout(timer);panel.hidden=true;}});
  return {refresh,render,panel};
}
