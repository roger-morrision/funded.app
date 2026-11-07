import {validatePreferenceTransfer} from '../../../experience-preferences.js';

const empty=()=>({version:1,wallets:[],creators:[],reminders:[]});
let app,owner=null,preferences=empty(),csrf='',generation=0,queue=Promise.resolve();
const publish=()=>{window.dispatchEvent(new Event('funded:account-preferences'));window.dispatchEvent(new Event('funded:following-changed'));};
export function accountPreferences(){return structuredClone(owner&&owner===app?.connectedWalletAddress?preferences:empty());}
export function accountFavorites(){return app?.getWatchlist?.()||[];}
function clear(wallet=null){owner=wallet;preferences=empty();csrf='';generation++;publish();}
async function load(session){
  if(owner!==session.address)clear(session.address);
  const epoch=generation;
  const result=await app.apiRequest(`/api/account-preferences?wallet=${encodeURIComponent(session.address)}`,{cache:'no-store'});
  app.assertWalletSessionCurrent(session);
  if(epoch!==generation)throw new Error('Your wallet changed. Please try again.');
  if(!result.available||result.data?.wallet!==owner)throw new Error('Your saved items could not be loaded. Please sign in again.');
  preferences=validatePreferenceTransfer(result.data.preferences);csrf=result.data.csrf;publish();
}
export function refreshAccountPreferences(){
  const session=app?.captureWalletSession();
  if(!session){if(owner)clear();return Promise.resolve(false);}
  if(owner!==session.address)clear(session.address);
  // Serialize refreshes with writes: an older focus refresh cannot replace a
  // successful save with stale preferences from before that write.
  const task=queue.then(async()=>{
    try{app.assertWalletSessionCurrent(session);if(!await app.ensureReferralSession(session,{interactive:false})){if(app.isWalletSessionCurrent(session))clear(session.address);return false;}await load(session);return true;}
    catch{if(app.isWalletSessionCurrent(session))clear(session.address);return false;}
  });
  queue=task.catch(()=>{});return task;
}
export function saveAccountPreference(kind,item,{remove=false}={}){
  const requested=app?.captureWalletSession();
  const task=queue.then(async()=>{
    if(!app)throw new Error('Please wait for your account to load.');
    if(requested)app.assertWalletSessionCurrent(requested);
    else if(!app.captureWalletSession())await app.connectWallet();
    const session=requested||app.captureWalletSession();
    if(!session)throw new Error('Connect your wallet to save this item.');
    if(!await app.ensureReferralSession(session,{interactive:true}))throw new Error('Sign in with your wallet to save this item.');
    app.assertWalletSessionCurrent(session);
    await load(session);const epoch=generation;
    const result=await app.apiRequest(`/api/account-preferences?wallet=${encodeURIComponent(session.address)}`,{method:'POST',headers:{'x-preferences-csrf':csrf},body:{wallet:session.address,kind,action:remove?'remove':'add',...(remove?{id:item}:{item})}});
    app.assertWalletSessionCurrent(session);
    if(epoch!==generation)throw new Error('Your wallet changed. Please reload your saved items.');
    if(!result.available||result.data?.wallet!==owner)throw new Error('Your change could not be saved. Please try again.');
    preferences=validatePreferenceTransfer(result.data.preferences);publish();return true;
  });
  queue=task.catch(()=>{});return task;
}
export function initializeAccountPreferences(application){
  if(app)return;app=application;
  window.addEventListener('funded:reward-identity-change',()=>{clear(app.connectedWalletAddress||null);void refreshAccountPreferences();});
  window.addEventListener('funded:wallet-authenticated',()=>{void refreshAccountPreferences();});
  window.addEventListener('focus',()=>{if(!document.hidden)void refreshAccountPreferences();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshAccountPreferences();});
  void refreshAccountPreferences();
}
