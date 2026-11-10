import {createHash,randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {adminEmailConfig} from './admin-email-delivery.mjs';
import {buildXPost,sanitizeXLabel,xWeightedLength} from './x-post-content.mjs';
import {launchPromotionPreview} from '../launch-promotion-copy.js';
import {verifyMigrationEmailProof} from './promotion-migration-proof.mjs';
import {verifyPumpLaunch} from './launch-verification.mjs';
import {assertRpcNetwork} from '../solana-network.js';

export const launchPostEmailEnabled=env=>env.FUNDED_LAUNCH_POST_EMAIL_ENABLED==='true'
  &&env.FUNDED_API_ONLY!=='true';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const paidLaunchPromotion = launch => launch?.creatorLaunchBurn?.status==='verified'
  && ['boost','pro','premier'].includes(launch.creatorLaunchBurn.tier)
  && Number.isSafeInteger(launch.creatorLaunchBurn.amountTokens) && launch.creatorLaunchBurn.amountTokens>0;
export function launchPostEmailDraft(launch,{cluster,origin,version=2,event='launch',migration=null}) {
  if(launch?.cluster!==cluster||!launch.onchainVerified||!launch.pumpFeeRoute?.verified
    ||launch.pumpFeeRoute.scope!=='per-mint-v3'||launch.pumpFeeRoute.transaction!==launch.signature)
    throw Error('A verified registered launch is required for its post email.');
  const burn=launch.creatorLaunchBurn;
  const tier=burn?.status==='verified'&&['pro','premier'].includes(burn.tier)?burn.tier:'standard';
  let post=buildXPost('launch',{mint:launch.mint,name:launch.name,symbol:launch.symbol,marketingTier:tier,
    proofs:[{signature:launch.signature,slot:launch.slot,cluster,commitment:'finalized',verified:true}]},
  {cluster,publicOrigin:origin});
  if(!['launch','migration'].includes(event))throw Error('Unsupported promotion event.');
  if(event==='migration'&&(!paidLaunchPromotion(launch)||migration?.cluster!==cluster||migration?.mint!==launch.mint
    ||migration?.verified!==true||migration?.commitment!=='finalized'||!Number.isSafeInteger(migration.slot)
    ||migration.slot<=launch.slot||!migration.signature))throw Error('A finalized migration proof and paid promotion are required.');
  if(version===2){
    const shares=launch.feeDistribution?.creatorDirected?.shares||{},lock=launch.developerTokenLock;
    const text=launchPromotionPreview(sanitizeXLabel(launch.name),{symbol:launch.symbol,description:launch.description ? sanitizeXLabel(launch.description,280) : '',
      holderPercent:shares.holderAirdropPercent,xPercent:shares.solClaimPercent,creatorPercent:shares.creatorWalletPercent,
      airdropPercent:launch.communityAllocation,developerBuy:lock?.verified?BigInt(lock.amount||'0')>0n:null,
      lockHours:lock?.verified?Number(lock.lockSeconds)/3600:null,
      tier:paidLaunchPromotion(launch)?burn.tier:'standard',burnTokens:paidLaunchPromotion(launch)?burn.amountTokens:0,
      cluster,event,link:`${new URL(origin).origin}/token/${launch.mint}`});
    if(xWeightedLength(text)>280)throw Error('Promotion facts exceed one X post.');
    post={text,weightedLength:xWeightedLength(text)};
  }else if(version!==1||event!=='launch')throw Error('Unsupported promotion draft version.');
  const id=`${cluster}:${launch.mint}:${launch.signature}${event==='migration'?':migration':''}`;
  return {id,cluster,mint:launch.mint,signature:launch.signature,slot:launch.slot,
    name:sanitizeXLabel(launch.name||launch.symbol),origin:new URL(origin).origin,text:post.text,
    contentHash:digest({id,text:post.text}),weightedLength:post.weightedLength,
    ...(version===2?{version,event}:{}),...(event==='migration'?{migrationSignature:migration.signature,migrationSlot:migration.slot}:{})};
}

// Atomic with launch insertion. Registration retries never backfill old launches.
export function enqueueLaunchPostEmail(state,launch,{env,cluster,now=Date.now()}) {
  if(!launchPostEmailEnabled(env))return null;
  const draft=launchPostEmailDraft(launch,{cluster,origin:env.PUBLIC_APP_URL||env.CORS_ORIGIN});
  const outbox=state.launchPostEmails||={};
  const row=outbox[draft.id] ||= {...draft,status:'pending',createdAt:now,nextAttemptAt:now,attempts:0};
  if(paidLaunchPromotion(launch))outbox[draft.id+':migration'] ||= {
    id:draft.id+':migration',version:2,event:'migration',cluster,mint:launch.mint,signature:launch.signature,
    origin:draft.origin,status:'awaiting-migration',createdAt:now,nextCheckAt:now,attempts:0};
  return row;
}

const htmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function promotionXIntent(text){const url=new URL('https://twitter.com/intent/tweet');url.searchParams.set('text',text);return url.href;}

export async function deliverLaunchPostEmail({env,draft,createTransport=options=>nodemailer.createTransport(options)}) {
  const config=adminEmailConfig(env);
  if(config.provider!=='gmail')throw Object.assign(Error('Launch post emails require the configured Gmail sender.'),{delivery:'not-sent'});
  const transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,
    tls:{servername:'smtp.gmail.com',minVersion:'TLSv1.2',rejectUnauthorized:true},
    auth:{user:config.from,pass:config.key},pool:false,logger:false,debug:false,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,
    disableFileAccess:true,disableUrlAccess:true});
  const messageId=`<launch-${digest(draft.id)}@${new URL(draft.origin).hostname}>`;
  const event=draft.event==='migration'?'migration':'launch',action=promotionXIntent(draft.text);
  const intro=`Your token ${event} is finalized. Review the draft and post it manually on X.`;
  try{
    const result=await transport.sendMail({from:config.from,to:[config.to],
      envelope:{from:config.from,to:[config.to]},messageId,
      subject:`[${draft.cluster==='devnet'?'Devnet':'Mainnet'}] X ${event} post ready: ${draft.name}`,
      text:`${intro}\nNothing has been posted to X automatically.\n\n--- COPY POST ---\n${draft.text}\n--- END POST ---\n\nPost to X: ${action}\nOpens a prefilled composer; click Post on X to publish.\n\nToken page: ${draft.origin}/token/${draft.mint}\nFinalized ${event}: ${draft.migrationSignature||draft.signature}\nX character count: ${draft.weightedLength}/280\n\nAllocations are policy terms, not proof of completed reward payments. ${draft.cluster==='devnet'?'This is a Devnet test. Keep the Devnet label when sharing.':''}`,
      html:`<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:640px"><h2>${htmlEscape(event==='migration'?'Migration post ready':'Launch post ready')}</h2><p>${htmlEscape(intro)}</p><pre style="white-space:pre-wrap;background:#f3f4f6;padding:20px;border-radius:8px;font-family:Arial,sans-serif">${htmlEscape(draft.text)}</pre><p><a href="${htmlEscape(action)}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Post to X</a></p><p>Opens X with this draft prefilled. Review it, then click Post to publish. Nothing is posted automatically.</p><p>Fee and airdrop allocations are policy terms; migration alone does not confirm reward delivery.</p><p><a href="${htmlEscape(draft.origin+'/token/'+draft.mint)}">View token details</a></p></div>`});
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
  deliver=deliverLaunchPostEmail,verifyLaunch=verifyPumpLaunch,verifyMigration=verifyMigrationEmailProof,logger=console}) {
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
        const migration=claimed.event==='migration'?await verifyMigration({connection,cluster,mint:claimed.mint,
          signature:claimed.migrationSignature}):null;
        const expected=launchPostEmailDraft(launch,{cluster,origin:claimed.origin,version:claimed.version||1,event:claimed.event||'launch',migration});
        if(Object.entries(expected).some(([key,value])=>claimed[key]!==value))throw Error('Launch email content changed.');
        const burn=launch.creatorLaunchBurn;
        const proof=await verifyLaunch({connection,mint:claimed.mint,signature:claimed.signature,commitment:'finalized',cluster,
          ...(claimed.version===2&&paidLaunchPromotion(launch)?{promotionClaim:burn,fundedMint:burn.fundedMint,
            promotionTiers:[{id:burn.tier,label:burn.tier,amountTokens:burn.amountTokens}]}:{})});
        if(!proof.onchainVerified||proof.mint!==claimed.mint||proof.cluster!==cluster||proof.signature!==claimed.signature||proof.slot!==claimed.slot
          ||proof.creator!==launch.creator||proof.feePayer!==launch.creatorWallet||proof.name!==launch.name||proof.symbol!==launch.symbol)
          throw Error('Launch email receipt identity changed.');
        if(claimed.version===2&&paidLaunchPromotion(launch)
          &&(proof.creatorLaunchBurn?.tier!==burn.tier||proof.creatorLaunchBurn?.amountTokens!==burn.amountTokens))
          throw Error('Promotion burn verification changed.');
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
