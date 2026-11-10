import {createHash,randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {adminEmailConfig} from './admin-email-delivery.mjs';
import {buildXPost,sanitizeXLabel} from './x-post-content.mjs';
import {verifyPumpLaunch} from './launch-verification.mjs';
import {assertRpcNetwork} from '../solana-network.js';

export const launchPostEmailEnabled=env=>env.FUNDED_LAUNCH_POST_EMAIL_ENABLED==='true'
  &&env.FUNDED_API_ONLY!=='true';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function launchPostEmailDraft(launch,{cluster,origin}) {
  if(launch?.cluster!==cluster||!launch.onchainVerified||!launch.pumpFeeRoute?.verified
    ||launch.pumpFeeRoute.scope!=='per-mint-v3'||launch.pumpFeeRoute.transaction!==launch.signature)
    throw Error('A verified registered launch is required for its post email.');
  const burn=launch.creatorLaunchBurn;
  const tier=burn?.status==='verified'&&['pro','premier'].includes(burn.tier)?burn.tier:'standard';
  const post=buildXPost('launch',{mint:launch.mint,name:launch.name,symbol:launch.symbol,marketingTier:tier,
    proofs:[{signature:launch.signature,slot:launch.slot,cluster,commitment:'finalized',verified:true}]},
  {cluster,publicOrigin:origin});
  const id=`${cluster}:${launch.mint}:${launch.signature}`;
  return {id,cluster,mint:launch.mint,signature:launch.signature,slot:launch.slot,
    name:sanitizeXLabel(launch.name||launch.symbol),origin:new URL(origin).origin,text:post.text,
    contentHash:digest({id,text:post.text}),weightedLength:post.weightedLength};
}

// Atomic with launch insertion. Registration retries never backfill old launches.
export function enqueueLaunchPostEmail(state,launch,{env,cluster,now=Date.now()}) {
  if(!launchPostEmailEnabled(env))return null;
  const draft=launchPostEmailDraft(launch,{cluster,origin:env.PUBLIC_APP_URL||env.CORS_ORIGIN});
  const outbox=state.launchPostEmails||={};
  return outbox[draft.id] ||= {...draft,status:'pending',createdAt:now,nextAttemptAt:now,attempts:0};
}

export async function deliverLaunchPostEmail({env,draft,createTransport=options=>nodemailer.createTransport(options)}) {
  const config=adminEmailConfig(env);
  if(config.provider!=='gmail')throw Object.assign(Error('Launch post emails require the configured Gmail sender.'),{delivery:'not-sent'});
  const transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,
    tls:{servername:'smtp.gmail.com',minVersion:'TLSv1.2',rejectUnauthorized:true},
    auth:{user:config.from,pass:config.key},pool:false,logger:false,debug:false,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,
    disableFileAccess:true,disableUrlAccess:true});
  const messageId=`<launch-${digest(draft.id)}@${new URL(draft.origin).hostname}>`;
  try{
    const result=await transport.sendMail({from:config.from,to:[config.to],
      envelope:{from:config.from,to:[config.to]},messageId,
      subject:`[${draft.cluster==='devnet'?'Devnet':'Mainnet'}] X post ready: ${draft.name}`,
      text:`Your token launch is finalized. Copy the post below, review it, and publish it manually on X. Nothing has been posted to X automatically.\n\n--- COPY POST ---\n${draft.text}\n--- END POST ---\n\nToken page: ${draft.origin}/token/${draft.mint}\nFinalized launch: ${draft.signature}\nX character count: ${draft.weightedLength}/280\n\n${draft.cluster==='devnet'?'This is a Devnet test launch. Keep the Devnet label when sharing.':'Review the token details and applicable disclosures before posting.'}`});
    if(!result?.accepted?.some(address=>String(address).toLowerCase()===config.to.toLowerCase())||result.rejected?.length)
      throw Object.assign(Error('Recipient was not acknowledged.'),{delivery:'uncertain'});
    return {messageId,recipient:config.to,provider:'gmail',accepted:true};
  }catch(error){
    // SMTP cannot guarantee idempotency. Never retry an ambiguous DATA response.
    const safe=error.delivery==='not-sent'||['CONN','EHLO','HELO','AUTH','MAIL FROM','RCPT TO'].includes(error.command);
    throw Object.assign(Error('Launch post email delivery failed.'),{delivery:safe?'not-sent':'uncertain'});
  }finally{transport.close();}
}

export function createLaunchPostEmailWorker({store,connection,cluster,env=process.env,now=Date.now,
  deliver=deliverLaunchPostEmail,verifyLaunch=verifyPumpLaunch,logger=console}) {
  let running=false,timer;
  const enabled=launchPostEmailEnabled(env)&&cluster==='devnet';
  async function tick(){
    if(!enabled||running)return {status:enabled?'busy':'disabled'};
    running=true;
    let claimed;
    const finish=async values=>store.update(state=>{
      const row=state.launchPostEmails?.[claimed.id];
      if(row?.lease!==claimed.lease)throw Error('Launch email lease changed.');
      Object.assign(row,values,{lease:null,leaseUntil:0,updatedAt:now()});
    });
    try{
      const config=adminEmailConfig(env);
      if(config.provider!=='gmail')return {status:'configuration-unavailable'};
      claimed=await store.update(state=>{
        const rows=Object.values(state.launchPostEmails||{}).filter(row=>row.cluster===cluster);
        for(const row of rows)if(['verifying','sending'].includes(row.status)&&row.leaseUntil<=now()){
          row.status=row.status==='sending'?'uncertain':'pending';row.lease=null;
        }
        if(rows.some(row=>(row.lastAttemptAt||0)>now()-60000))return null;
        const row=rows.filter(row=>row.status==='pending'&&row.nextAttemptAt<=now())
          .sort((a,b)=>a.createdAt-b.createdAt)[0];
        if(!row)return null;
        Object.assign(row,{status:'verifying',lease:randomUUID(),leaseUntil:now()+120000,lastAttemptAt:now()});
        return structuredClone(row);
      });
      if(!claimed)return {status:'idle'};
      try{
        await assertRpcNetwork(connection,cluster);
        const launch=(await store.read()).launches?.[claimed.mint];
        const expected=launchPostEmailDraft(launch,{cluster,origin:claimed.origin});
        if(Object.entries(expected).some(([key,value])=>claimed[key]!==value))throw Error('Launch email content changed.');
        const proof=await verifyLaunch({connection,mint:claimed.mint,signature:claimed.signature,commitment:'finalized',cluster});
        if(!proof.onchainVerified||proof.mint!==claimed.mint||proof.cluster!==cluster||proof.signature!==claimed.signature||proof.slot!==claimed.slot
          ||proof.creator!==launch.creator||proof.feePayer!==launch.creatorWallet||proof.name!==launch.name||proof.symbol!==launch.symbol)
          throw Error('Launch email receipt identity changed.');
      }catch{
        await finish({status:'pending',nextAttemptAt:now()+300000,reason:'launch-verification-unavailable'});
        return {status:'verification-pending'};
      }
      await store.update(state=>{
        const row=state.launchPostEmails?.[claimed.id];
        if(row?.lease!==claimed.lease||row.status!=='verifying'||row.leaseUntil<=now())throw Error('Launch email lease expired.');
        Object.assign(row,{status:'sending',attempts:row.attempts+1,leaseUntil:now()+120000});
      });
      let result;
      try{result=await deliver({env,draft:claimed});}
      catch(error){
        const retry=error.delivery==='not-sent'&&claimed.attempts<4;
        await finish({status:retry?'pending':error.delivery==='not-sent'?'failed':'uncertain',
          nextAttemptAt:now()+300000,reason:retry?'delivery-not-sent':'delivery-needs-review'});
        return {status:retry?'pending':'needs-review'};
      }
      // Lost persistence after delivery remains sending/uncertain, never resent.
      if(result?.accepted!==true)throw Error('Launch email acknowledgment is unavailable.');
      await finish({status:'sent',sentAt:now(),result,reason:null});
      return {status:'sent',id:claimed.id};
    }catch{
      logger.error(JSON.stringify({event:'launch-post-email-unavailable'}));
      return {status:'unavailable'};
    }finally{running=false;}
  }
  return {enabled,tick,start(){if(enabled&&!timer){void tick();timer=setInterval(()=>void tick(),60000);timer.unref();}},
    stop(){clearInterval(timer);timer=null;}};
}
