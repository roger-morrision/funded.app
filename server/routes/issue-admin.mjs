import {reviewProductIssue} from '../product-issue-review.mjs';
// Called only after the existing allowlisted admin session and origin checks.
export async function handleIssueAdmin(req,res,url,{store,body,json}){
  if(!url.pathname.startsWith('/api/admin/product-issues'))return false;
  if(req.method==='GET'&&url.pathname==='/api/admin/product-issues'){
    const rows=Object.values((await store.read()).productIssues||{}).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,100)
      .map(({id,category,description,context,status,note,createdAt,updatedAt})=>({id,category,description,context,status,note,createdAt,updatedAt}));
    return json(res,200,{cluster:'devnet',reports:rows,coverage:'Latest 100 reports. Access tokens are never included.'});
  }
  const id=url.pathname.match(/^\/api\/admin\/product-issues\/([a-f0-9]{32})$/)?.[1];
  if(req.method==='POST'&&id){
    const result=await reviewProductIssue({store,id,input:await body(req)});
    return json(res,result.status,result.data);
  }
  return json(res,405,{error:'Method not allowed.'});
}
