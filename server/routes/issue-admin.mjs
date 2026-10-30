import { issueStates } from './product-issues.mjs';
// Called only after the existing allowlisted admin session and origin checks.
export async function handleIssueAdmin(req,res,url,{store,body,json}){
  if(!url.pathname.startsWith('/api/admin/product-issues'))return false;
  if(req.method==='GET'&&url.pathname==='/api/admin/product-issues'){
    const rows=Object.values((await store.read()).productIssues||{}).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,100)
      .map(({id,category,description,context,status,note,createdAt,updatedAt})=>({id,category,description,context,status,note,createdAt,updatedAt}));
    return json(res,200,{cluster:'devnet',reports:rows,coverage:'Latest 100 reports. Access tokens are never included.'});
  }
  const id=url.pathname.match(/^\/api\/admin\/product-issues\/([a-f0-9]{32})$/)?.[1];
  if(req.method==='POST'&&id){const input=await body(req);
    if(!issueStates.includes(input.status)||typeof input.note!=='string'||input.note.length>500)return json(res,400,{error:'Choose a valid status and a note up to 500 characters.'});
    const saved=await store.update(state=>{const row=state.productIssues?.[id];if(!row)return null;row.status=input.status;row.note=input.note;row.updatedAt=new Date().toISOString();return {id,status:row.status,note:row.note,updatedAt:row.updatedAt};});
    return saved?json(res,200,saved):json(res,404,{error:'Report not found.'});
  }
  return json(res,405,{error:'Method not allowed.'});
}
