import {createXPostStore} from './x-post-store.mjs';

// Called only after signed admin session and same-origin checks. No publish,
// unpause, credential or financial execution endpoint is exposed here.
export async function handleAdminXPosts({req,res,url,body,respond,session,env,createStore=createXPostStore}){
  if(!url.pathname.startsWith('/api/admin/x-posts'))return false;
  const send=(status,value)=>{respond(res,status,value);return true;};
  if(!env.DATABASE_URL)return send(503,{error:'Durable X editorial storage is unavailable.'});
  const store=createStore({databaseUrl:env.DATABASE_URL,accountId:'fundedvip'});
  try{
    await store.init();
    if(req.method==='GET'&&url.pathname==='/api/admin/x-posts')return send(200,{safety:await store.safetyStatus(),
      events:await store.list({status:'pending',limit:200,reviewable:true})});
    if(req.method==='POST'&&url.pathname==='/api/admin/x-posts/review'){
      const input=await body(req)||{};
      const event=await store.review({id:input.id,expectedHash:input.expectedHash,decision:input.decision,reason:input.reason,actor:session.wallet});
      return send(200,{event,safety:await store.safetyStatus(),published:false});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/x-posts/pause')return send(200,{safety:await store.pause('account-suspended'),published:false});
    return send(404,{error:'Unknown X editorial action.'});
  }catch(error){return send(400,{error:error.message});}
  finally{await store.close();}
}
