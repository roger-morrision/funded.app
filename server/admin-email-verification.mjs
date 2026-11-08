import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {adminEmailConfig,deliverAdminCode} from './admin-email-delivery.mjs';

const AUTH_PATHS=new Set(['/api/admin/challenge','/api/admin/session','/api/admin/logout','/api/admin/email-confirmation']);
// In-process capability only; cannot be supplied via JSON, cookie or HTTP header.
export const ADMIN_EMAIL_AUTHORIZED=Symbol('admin-email-authorized');
export const adminWriteNeedsEmail=(method,path)=>!['GET','HEAD','OPTIONS'].includes(method)&&!AUTH_PATHS.has(path);
const fail=(status,message)=>Object.assign(Error(message),{status});
function canonical(value,depth=0){
  if(depth>20)throw fail(400,'Admin request is too deeply nested.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(item=>canonical(item,depth+1)).join(',')+']';
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',')+'}';
  throw fail(400,'Admin requests must contain JSON values.');
}
export function adminActionDigest(method,path,payload){
  if(!['POST','PUT','PATCH','DELETE'].includes(method)||!/^\/api\/admin\/[a-z0-9/-]+$/.test(path)
    ||!adminWriteNeedsEmail(method,path))throw fail(400,'Invalid admin confirmation action.');
  const text=canonical(payload);
  if(Buffer.byteLength(text)>16000)throw fail(400,'Admin confirmation request is too large.');
  return{payload:text,digest:createHash('sha256').update(`${method}\n${path}\n${text}`).digest('hex')};
}

// Session and confirmation state share one API-process lifetime. A restart revokes
// both; there is no persisted OTP or development bypass. Consume before any await.
export function createAdminEmailVerification({env,cluster,origin,now=Date.now,
  send=deliverAdminCode,configuration=adminEmailConfig}={}){
  const pending=new Map(),limits=new Map(),secret=randomBytes(32);
  const hash=(id,code)=>createHmac('sha256',secret).update(`${id}:${code}`).digest();
  function prune(){
    for(const [id,row]of pending)if(row.expiresAt<=now())pending.delete(id);
    for(const [key,row]of limits)if(row.start+3600000<=now())limits.delete(key);
  }
  function revoke(sessionId){for(const[id,row]of pending)if(row.sessionId===sessionId)pending.delete(id);}
  return{
    revoke,
    async issue({sessionId,wallet,method,path,payload}){
      const action=adminActionDigest(method,path,payload);
      let config;try{config=configuration(env);}catch{throw fail(503,'Admin email verification is not configured. Write actions are blocked.');}
      prune();const time=now();
      // Mailbox-wide limit survives logout/new sessions, preventing resend storms.
      const rate=limits.get(config.to)||{start:time,count:0,last:-Infinity};
      if(time-rate.last<60000||rate.count>=10)throw fail(429,'Wait before requesting another code (one per minute, ten per hour).');
      if(pending.size>=500)throw fail(429,'Admin confirmation capacity reached. Try later.');
      rate.count++;rate.last=time;limits.set(config.to,rate);revoke(sessionId);
      const id=randomBytes(24).toString('hex'),code=String(randomInt(0,100000000)).padStart(8,'0');
      const row={id,sessionId,wallet,method,path,...action,recipient:config.to,
        expiresAt:time+5*60000,tries:0,hash:hash(id,code),ready:false};
      pending.set(id,row);
      // Delivery receives no wallet, payload, cookie or signing key.
      try{await send({env,to:config.to,id,code,method,path,cluster,origin:origin(),expiresAt:row.expiresAt,digest:row.digest});}
      catch{pending.delete(id);throw fail(503,'Admin confirmation email could not be sent. No action was authorized.');}
      if(pending.get(id)!==row||row.expiresAt<=now())throw fail(409,'Admin confirmation expired. Request a new code.');
      row.ready=true;
      return{id,expiresAt:new Date(row.expiresAt).toISOString(),digest:row.digest,
        recipient:config.to.replace(/^(.).*(@.*)$/,'$1***$2')};
    },
    consume({sessionId,wallet,method,path,payload,id,code}){
      prune();const row=pending.get(String(id||''));
      if(!row||!row.ready||row.sessionId!==sessionId||row.wallet!==wallet)
        throw fail(403,'Request a confirmation code for this admin action.');
      if(++row.tries>=5)pending.delete(row.id);
      let recipient;try{recipient=configuration(env).to;}catch{pending.delete(row.id);throw fail(503,'Admin email verification is unavailable.');}
      const action=adminActionDigest(method,path,payload);
      if(row.recipient!==recipient||row.digest!==action.digest||!/^\d{8}$/.test(String(code||''))
        ||!timingSafeEqual(row.hash,hash(row.id,String(code))))
        throw fail(403,'Invalid confirmation code or changed action. Review the request and try again.');
      pending.delete(row.id);
      return{id:row.id,digest:row.digest,wallet,method,path,at:new Date(now()).toISOString()};
    }
  };
}
