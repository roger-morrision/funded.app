import {PublicKey} from '@solana/web3.js';
import {allowedAuthOrigin} from '../x-auth.mjs';

export function createProjectUpdateRoutes({store,body,referralSession,cluster,respond,origin=process.env.CORS_ORIGIN,now=Date.now}) {
  const json=(res,status,value)=>{respond(res,status,value);return true;};
  const creator=launch=>launch?.cluster===cluster&&launch.onchainVerified===true
    &&launch.pumpFeeRoute?.verified===true ? launch.creatorWallet||launch.feePayer : null;
  return async(req,res,url)=>{
    const match=url.pathname.match(/^\/api\/tokens\/([^/]+)\/updates$/);if(!match)return false;
    let mint;try{mint=new PublicKey(decodeURIComponent(match[1])).toBase58();}catch{return json(res,400,{error:'Invalid token address.'});}
    if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
    const state=await store.read(),owner=creator(state.launches?.[mint]),key=`${cluster}:${mint}`;
    if(!owner)return json(res,404,{error:'Verified project unavailable.'});
    if(req.method==='GET')return json(res,200,{mint,cluster,creator:owner,updates:state.projectUpdates?.[key]||[]});
    if(!allowedAuthOrigin(req,origin))return json(res,403,{error:'Project update origin is not allowed.'});
    const session=await referralSession(req);
    if(!session?.wallet)return json(res,401,{error:'Sign in with the creator wallet to publish an update.'});
    if(session.wallet!==owner)return json(res,403,{error:'Only the original creator wallet can update this project.'});
    const input=await body(req);
    const id=String(input.id||''),text=typeof input.text==='string'?input.text.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu,c=>c==='\n'?'\n':' ').trim():'';
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)||!text||text.length>2000)
      return json(res,400,{error:'Enter an update of 1–2,000 characters with a valid request ID.'});
    if(!await store.chargeRpcRate(`project-update:${cluster}:${owner}`,1,5,Math.floor(now()/60000)*60000))
      return json(res,429,{error:'Please wait a minute before publishing another update.'});
    const result=await store.update(saved=>{
      if(creator(saved.launches?.[mint])!==session.wallet)return {status:403,error:'Project creator verification changed.'};
      const rows=(saved.projectUpdates||={})[key]||=[];
      const existing=rows.find(row=>row.id===id);
      if(existing){
        if(existing.text===text)return {status:200,update:existing};
        if(input.expectedVersion!==existing.version)return {status:409,error:'This update changed. Refresh before editing.'};
        Object.assign(existing,{text,updatedAt:new Date(now()).toISOString(),version:existing.version+1});
        return {status:200,update:existing};
      }
      if(input.expectedVersion!=null)return {status:404,error:'Project update not found.'};
      if(rows.length>=100)return {status:409,error:'This project has reached its 100-update limit.'};
      const update={id,mint,cluster,author:session.wallet,text,createdAt:new Date(now()).toISOString(),version:1};
      rows.unshift(update);return {status:201,update};
    });
    return json(res,result.status,result.error?{error:result.error}:{mint,cluster,update:result.update});
  };
}
