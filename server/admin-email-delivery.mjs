import {readFileSync} from 'node:fs';

const validEmail=value=>/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)
  && !/REPLACE|example\.(com|invalid)|\.invalid$/i.test(value);
// Recipient and sender are server configuration, never browser input.
export function adminEmailConfig(env) {
  const to=String(env.FUNDED_ADMIN_EMAIL||'').trim(),from=String(env.FUNDED_ADMIN_EMAIL_FROM||'').trim();
  if(env.FUNDED_ADMIN_EMAIL_PROVIDER!=='resend'||!validEmail(to)||!validEmail(from))
    throw Error('Admin email verification is not configured. Write actions are blocked.');
  let key=String(env.FUNDED_ADMIN_EMAIL_API_KEY||'').trim();
  if(!key&&env.FUNDED_ADMIN_EMAIL_API_KEY_FILE){
    try{key=readFileSync(env.FUNDED_ADMIN_EMAIL_API_KEY_FILE,'utf8').trim();}catch{}
  }
  if(!key||/REPLACE|\s/.test(key))throw Error('Admin email verification is not configured. Write actions are blocked.');
  return{to,from,key};
}
const actionName=path=>path.startsWith('/api/admin/withdrawals/')?'Treasury withdrawal'
  :path==='/api/admin/service-fees'?'Service fee update':path.includes('agency')?'Future-launch rules'
    :path.includes('daily-bonus')?'Daily bonus recovery':path.includes('x-posts')?'X publishing review'
      :path.includes('product-issues')?'Issue update':path.includes('v3-allocations')?'Allocation recovery':'Admin change';
export async function deliverAdminCode({env,to,id,code,path,cluster,origin,expiresAt,digest,fetchImpl=fetch}={}) {
  const config=adminEmailConfig(env||{});
  if(config.to!==to)throw Error('Admin confirmation recipient changed.');
  // Provider disclosure is deliberately limited. No wallet addresses, amounts,
  // exact payload, raw route, cookies or signing keys are included in the email.
  const response=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{authorization:`Bearer ${config.key}`,'content-type':'application/json','Idempotency-Key':id},
    body:JSON.stringify({from:config.from,to:[config.to],subject:'funded.vip admin action confirmation',
      text:`Confirmation code: ${code}\n\nAction: ${actionName(path)}\nExpires: ${new Date(expiresAt).toISOString()}\nApp: ${origin}\nNetwork: ${cluster}\nRequest fingerprint: ${digest}\n\nReview the exact action in the admin dialog before entering this code. It authorizes one API attempt only. If you did not request this action, do not share the code.`})
  });
  if(!response.ok)throw Error('Admin confirmation email could not be sent.');
  const result=await response.json().catch(()=>null);
  if(typeof result?.id!=='string'||!result.id)throw Error('Admin confirmation email was not acknowledged.');
}
