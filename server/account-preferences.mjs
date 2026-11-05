import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {allowedAuthOrigin,cookieValue} from './x-auth.mjs';
import {readJsonBody} from './request-body.mjs';
import {validatePreferenceTransfer} from '../experience-preferences.js';

export const emptyPreferences=()=>({version:1,wallets:[],creators:[],reminders:[]});
export function updateAccountPreferences(prior,input){
  const next=validatePreferenceTransfer(prior||emptyPreferences());
  if(!['wallets','creators','reminders'].includes(input.kind)||!['add','remove'].includes(input.action))throw new Error('Choose a saved item to update.');
  const key=row=>input.kind==='wallets'?row.address:input.kind==='reminders'?row.id:row;
  if(input.action==='add'){
    // Validate the incoming item independently before removing any previous value.
    validatePreferenceTransfer({...emptyPreferences(),[input.kind]:[input.item]});
    next[input.kind]=next[input.kind].filter(row=>key(row)!==key(input.item));
    next[input.kind].push(input.item);
  }else{
    if(typeof input.id!=='string'||input.id.length>100)throw new Error('Choose a saved item to remove.');
    next[input.kind]=next[input.kind].filter(row=>key(row)!==input.id);
  }
  return validatePreferenceTransfer(next);
}
export function createAccountPreferencesHandler({store,cluster,getWalletSession,origin=process.env.CORS_ORIGIN}){
  return async(req,res,url)=>{
    if(url.pathname!=='/api/account-preferences')return false;
    const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'private, no-store'});res.end(JSON.stringify(data));return true;};
    const wallet=url.searchParams.get('wallet');
    try{if(!wallet||new PublicKey(wallet).toBase58()!==wallet)throw new Error();}catch{return reply(400,{error:'Choose a valid wallet.'});}
    const session=await getWalletSession(req);
    if(session?.wallet!==wallet)return reply(401,{error:'Sign in with this wallet to save your items.'});
    const accountId=`wallet:${wallet}`;
    const csrf=createHash('sha256').update('funded-preferences:').update(cookieValue(req,'funded_referral_session')).digest('hex');
    if(req.method==='GET'){
      const row=await store.readWatchlist(accountId,cluster);
      return reply(200,{wallet,csrf,preferences:row.preferences||emptyPreferences()});
    }
    if(req.method!=='POST')return reply(405,{error:'Method not allowed.'});
    if(!allowedAuthOrigin(req,origin)||req.headers['x-preferences-csrf']!==csrf)return reply(403,{error:'Sign in again before saving.'});
    if(!await store.chargeRpcRate(`preferences:${wallet}`,1,120,Math.floor(Date.now()/60000)*60000))return reply(429,{error:'Please wait before saving again.'});
    let input;try{input=await readJsonBody(req,{maxBytes:4000});}catch(error){return reply(error.statusCode||400,{error:'Invalid update.'});}
    if(input?.wallet!==wallet)return reply(409,{error:'Your wallet changed. Please try again.'});
    try{
      // Reuse the account row lock: simultaneous devices update individual items,
      // preserving favorites and other changes without overwriting a whole list.
      const row=await store.updateWatchlist(accountId,cluster,prior=>({...prior,preferences:updateAccountPreferences(prior?.preferences,input)}));
      return reply(200,{wallet,preferences:row.preferences});
    }catch{return reply(400,{error:'This saved item could not be updated. Check its details and try again.'});}
  };
}
