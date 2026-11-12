import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {createStore} from '../server/store.mjs';
import {createLaunchPostEmailWorker,deliverLaunchPostEmail,enqueueLaunchPostEmail,launchPostEmailDraft} from '../server/launch-post-email.mjs';

const key=()=>Keypair.generate().publicKey.toBase58();
const env={FUNDED_LAUNCH_POST_EMAIL_ENABLED:'true',PUBLIC_APP_URL:'https://richpad.fun',
  FUNDED_ADMIN_EMAIL_PROVIDER:'gmail',FUNDED_ADMIN_EMAIL:'admin@richpad.fun',
  FUNDED_ADMIN_EMAIL_FROM:'fixture@gmail.com',FUNDED_ADMIN_GMAIL_APP_PASSWORD:'abcdefghijklmnop'};
function fixture(){
  const signature=bs58.encode(Buffer.alloc(64,2)),creator=key();
  const launch={cluster:'devnet',mint:key(),name:'QA token',symbol:'QA',signature,slot:123,
    onchainVerified:true,creator,creatorWallet:key(),pumpFeeRoute:{verified:true,scope:'per-mint-v3',transaction:signature}};
  let time=1794290000000,state={launches:{[launch.mint]:launch}},sent=0,failPersistence=false;
  enqueueLaunchPostEmail(state,launch,{env,cluster:'devnet',now:time});
  const store={read:async()=>structuredClone(state),update:async change=>{
    const copy=structuredClone(state),result=await change(copy);
    if(failPersistence&&Object.values(copy.launchPostEmails).some(row=>row.status==='sent'))throw Error('Database unavailable after delivery');
    state=copy;return structuredClone(result);
  }};
  const options={store,env,cluster:'devnet',now:()=>time,logger:{error(){}},
    connection:{getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'},
    verifyLaunch:async()=>({...launch,feePayer:launch.creatorWallet}),
    deliver:async()=>{sent++;return {accepted:true,messageId:'fixture'};}};
  return {launch,store,options,row:()=>Object.values(state.launchPostEmails)[0],sent:()=>sent,
    advance:ms=>{time+=ms;},failPersistence:()=>{failPersistence=true;}};
}

test('launch email contains bounded sanitized X copy and fixed app links',()=>{
  const f=fixture();f.launch.name='\r\nBcc: attacker@evil.test <script> 🎉'.repeat(8);
  const draft=launchPostEmailDraft(f.launch,{cluster:'devnet',origin:env.PUBLIC_APP_URL});
  assert(draft.text.startsWith('New launch: $QA'));assert(draft.text.includes('[Devnet test]'));assert(draft.weightedLength<=280);
  assert(!draft.name.includes('@')&&!draft.name.includes('\n')&&!draft.text.includes('<script>'));
  assert(draft.text.includes('https://richpad.fun/token/'+f.launch.mint));
  assert.throws(()=>launchPostEmailDraft({...f.launch,onchainVerified:false},{cluster:'devnet',origin:env.PUBLIC_APP_URL}));
  assert.throws(()=>launchPostEmailDraft(f.launch,{cluster:'devnet',origin:'http://evil.test'}));
});

test('durable launch outbox survives restart and duplicate registration sends once',async()=>{
  const f=fixture(),folder=await mkdtemp(join(tmpdir(),'launch-email-'));
  try{
    const path=join(folder,'state.json'),store=createStore(path,null);
    await store.update(state=>{state.launches[f.launch.mint]=f.launch;
      enqueueLaunchPostEmail(state,f.launch,{env,cluster:'devnet'});
      enqueueLaunchPostEmail(state,f.launch,{env,cluster:'devnet'});});
    const restored=createStore(path,null),worker=createLaunchPostEmailWorker({...f.options,store:restored,now:Date.now});
    assert.equal((await worker.tick()).status,'sent');
    assert.equal((await createLaunchPostEmailWorker({...f.options,store:createStore(path,null),now:Date.now}).tick()).status,'idle');
    assert.equal(f.sent(),1);assert.equal(Object.keys((await restored.read()).launchPostEmails).length,1);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('mail worker verifies finalized network and immutable content before delivery',async()=>{
  for(const kind of ['network','receipt','content']){
    const f=fixture(),options={...f.options};
    if(kind==='network')options.connection={getGenesisHash:async()=> 'wrong-network'};
    if(kind==='receipt')options.verifyLaunch=async()=>({...f.launch,slot:124});
    if(kind==='content')await f.store.update(state=>{Object.values(state.launchPostEmails)[0].text='Changed content';});
    assert.equal((await createLaunchPostEmailWorker(options).tick()).status,'verification-pending');
    assert.equal(f.sent(),0);assert.equal(f.row().attempts,0);
  }
});

test('ambiguous SMTP delivery and lost persistence are never retried automatically',async()=>{
  for(const kind of ['smtp','database']){
    const f=fixture();let calls=0;
    const deliver=async()=>{calls++;if(kind==='smtp')throw Object.assign(Error('provider data'),{delivery:'uncertain'});return {accepted:true};};
    if(kind==='database')f.failPersistence();
    await createLaunchPostEmailWorker({...f.options,deliver}).tick();f.advance(180000);
    await createLaunchPostEmailWorker({...f.options,deliver}).tick();
    assert.equal(calls,1);assert.equal(f.row().status,'uncertain');
  }
});

test('known pre-delivery failures retry within bounds; parallel replicas claim once',async()=>{
  const f=fixture();let calls=0;
  const deliver=async()=>{calls++;throw Object.assign(Error('connection'),{delivery:'not-sent'});};
  for(let n=0;n<5;n++){
    await createLaunchPostEmailWorker({...f.options,deliver}).tick();f.advance(300001);
  }
  assert.equal(f.row().status,'failed');assert.equal(calls,5);
  const g=fixture();await Promise.all([createLaunchPostEmailWorker(g.options).tick(),createLaunchPostEmailWorker(g.options).tick()]);
  assert.equal(g.sent(),1);
});

test('disabled and API-only instances cannot dispatch or backfill email',async()=>{
  const f=fixture();
  for(const options of [{env:{...env,FUNDED_LAUNCH_POST_EMAIL_ENABLED:'false'}},{env:{...env,FUNDED_API_ONLY:'true'}}])
    assert.equal((await createLaunchPostEmailWorker({...f.options,...options}).tick()).status,'disabled');
  const empty={launches:{[f.launch.mint]:f.launch}};
  await createLaunchPostEmailWorker({...f.options,store:{read:async()=>empty,update:async fn=>fn(empty)}}).tick();
  assert(!empty.launchPostEmails);assert.equal(f.sent(),0);
});

test('SMTP delivery fixes recipient, validates TLS and distinguishes DATA uncertainty',async()=>{
  const draft=fixture().row();let closed=0,message;
  const result=await deliverLaunchPostEmail({env,draft,createTransport:options=>{
    assert.equal(options.host,'smtp.gmail.com');assert.equal(options.tls.rejectUnauthorized,true);
    assert.equal(options.disableUrlAccess,true);assert.equal(options.disableFileAccess,true);
    return {close:()=>closed++,sendMail:async value=>{message=value;return {accepted:[env.FUNDED_ADMIN_EMAIL],rejected:[]};}};
  }});
  assert(result.accepted);assert.deepEqual(message.envelope.to,[env.FUNDED_ADMIN_EMAIL]);
  assert(message.text.includes('--- COPY POST ---'));assert(message.html.includes('Post to X'));
  const intent=new URL(message.text.match(/Post to X: (https:\/\/[^\s]+)/)[1]);
  assert.equal(intent.origin,'https://twitter.com');assert.equal(intent.searchParams.get('text'),draft.text);assert(!message.text.includes(env.FUNDED_ADMIN_GMAIL_APP_PASSWORD));
  assert.equal(closed,1);
  for(const [command,delivery] of [['CONN','not-sent'],['DATA','uncertain']]){
    await assert.rejects(deliverLaunchPostEmail({env,draft,createTransport:()=>({close(){},sendMail:async()=>{
      throw Object.assign(Error('private provider response'),{command});
    }})}),error=>error.delivery===delivery&&!error.message.includes('private'));
  }
});

test('verified external listing queues an admin X draft once',async()=>{
  const {enqueueListingPostEmail}=await import('../server/launch-post-email.mjs');
  const listing={cluster:'mainnet-beta',onchainVerified:true,status:'listed',mint:'So11111111111111111111111111111111111111112',
    signature:'5'.repeat(88),slot:9,name:'Wrapped SOL',symbol:'WSOL',wallet:'M1HfA8vPXwGGn8uv5p9BZSYjsh4jhxhoMfDx2sGsj4M'};
  const state={},options={env:{FUNDED_LAUNCH_POST_EMAIL_ENABLED:'true',PUBLIC_APP_URL:'https://richpad.fun'},cluster:'mainnet-beta'};
  const row=enqueueListingPostEmail(state,listing,options);
  assert.equal(row.event,'listing');assert.equal(row.status,'pending');
  assert.match(row.text,/New listing on Richpad: \$WSOL/);assert.match(row.text,/richpad\.fun\/token\/So111/);
  assert.equal(enqueueListingPostEmail(state,listing,options),row);
  assert.equal(Object.keys(state.launchPostEmails).length,1);
  assert.equal(enqueueListingPostEmail({},listing,{...options,env:{}}),null);
  assert.throws(()=>enqueueListingPostEmail({},{...listing,cluster:'devnet'},options));
});
