export const STALE_ADMIN_REQUEST='Previous admin session ended.';
export function createAdminSession({document=globalThis.document,onEnd=()=>{}}={}){
 const workspace=document.querySelector('#workspace');let epoch=0,active=false,expiry;
 const current=token=>token===epoch;
 function end(label='Not signed in'){
  clearTimeout(expiry);epoch++;active=false;workspace.dataset.sessionEpoch=String(epoch);
  workspace.hidden=true;workspace.inert=true;
  document.querySelector('#sign-out').hidden=true;document.querySelector('#auth-status').textContent=label;onEnd();return epoch;
 }
 function activate(session,token){
  if(!current(token))return false;
  const expiresAt=Date.parse(session.expiresAt),delay=expiresAt-Date.now();
  if(Number.isFinite(expiresAt)&&delay<=0){end('Session expired. Sign in again.');return false;}
  active=true;workspace.inert=false;workspace.hidden=false;
  document.querySelector('#sign-out').hidden=false;
  document.querySelector('#auth-status').textContent=`Signed in: ${session.wallet.slice(0,5)}…${session.wallet.slice(-5)}`;
  if(Number.isFinite(expiresAt))expiry=setTimeout(()=>end('Session expired. Sign in again.'),Math.min(delay,2147483647));
  return true;
 }
 workspace.inert=workspace.hidden;workspace.dataset.sessionEpoch='0';
 return{get epoch(){return epoch;},get active(){return active;},current,end,activate};
}
