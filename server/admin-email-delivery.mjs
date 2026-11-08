import {readFileSync} from 'node:fs';
import nodemailer from 'nodemailer';

const validEmail=value=>/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)
  && !/REPLACE|example\.(com|invalid)|\.invalid$/i.test(value);
// Recipient and sender are server configuration, never browser input.
export function adminEmailConfig(env) {
  const to=String(env.FUNDED_ADMIN_EMAIL||'').trim(),from=String(env.FUNDED_ADMIN_EMAIL_FROM||'').trim();
  const provider=String(env.FUNDED_ADMIN_EMAIL_PROVIDER||'');
  if(!['gmail','resend'].includes(provider)||!validEmail(to)||!validEmail(from))
    throw Error('Admin email verification is not configured. Write actions are blocked.');
  const variable=provider==='gmail'?'FUNDED_ADMIN_GMAIL_APP_PASSWORD':'FUNDED_ADMIN_EMAIL_API_KEY';
  let key=String(env[variable]||'').trim();
  if(!key&&env[`${variable}_FILE`]){
    try{key=readFileSync(env[`${variable}_FILE`],'utf8').trim();}catch{}
  }
  if(provider==='gmail')key=key.replace(/\s/g,'');
  if(!key||/REPLACE|\s/.test(key))throw Error('Admin email verification is not configured. Write actions are blocked.');
  if(provider==='gmail'&&!/^[a-zA-Z0-9]{16}$/.test(key))
    throw Error('Gmail requires a 16-character Google App Password. Write actions are blocked.');
  return{to,from,key,provider};
}
const actionName=path=>path.startsWith('/api/admin/withdrawals/')?'Treasury withdrawal'
  :path==='/api/admin/service-fees'?'Service fee update':path.includes('agency')?'Future-launch rules'
    :path.includes('daily-bonus')?'Daily bonus recovery':path.includes('x-posts')?'X publishing review'
      :path.includes('product-issues')?'Issue update':path.includes('v3-allocations')?'Allocation recovery':'Admin change';
export async function deliverAdminCode({env,to,id,code,path,cluster,origin,expiresAt,digest,fetchImpl=fetch,
  createTransport=options=>nodemailer.createTransport(options)}={}) {
  const config=adminEmailConfig(env||{});
  if(config.to!==to)throw Error('Admin confirmation recipient changed.');
  // Provider disclosure is deliberately limited. No wallet addresses, amounts,
  // exact payload, raw route, cookies or signing keys are included in the email.
  const message={from:config.from,to:[config.to],subject:'funded.vip admin action confirmation',
    text:`Confirmation code: ${code}\n\nAction: ${actionName(path)}\nExpires: ${new Date(expiresAt).toISOString()}\nApp: ${origin}\nNetwork: ${cluster}\nRequest fingerprint: ${digest}\n\nReview the exact action in the admin dialog before entering this code. It authorizes one API attempt only. If you did not request this action, do not share the code.`};
  if(config.provider==='gmail'){
    const transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,
      tls:{servername:'smtp.gmail.com',minVersion:'TLSv1.2',rejectUnauthorized:true},
      auth:{user:config.from,pass:config.key},pool:false,logger:false,debug:false,
      connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,
      disableFileAccess:true,disableUrlAccess:true});
    try{
      const result=await transport.sendMail({...message,envelope:{from:config.from,to:[config.to]}});
      if(!result?.accepted?.some(address=>String(address).toLowerCase()===config.to.toLowerCase())
        ||result.rejected?.length)throw Error('Gmail did not accept the confirmation recipient.');
    }catch{throw Error('Gmail confirmation email could not be sent. No action was authorized.');}
    finally{transport.close();}
    return;
  }
  const response=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{authorization:`Bearer ${config.key}`,'content-type':'application/json','Idempotency-Key':id},
    body:JSON.stringify(message)
  });
  if(!response.ok)throw Error('Admin confirmation email could not be sent.');
  const result=await response.json().catch(()=>null);
  if(typeof result?.id!=='string'||!result.id)throw Error('Admin confirmation email was not acknowledged.');
}
