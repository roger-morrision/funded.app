import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { financialReceipt,financialOperations } from '../server/product-insights.mjs';
import { createProductInsightsRoutes } from '../server/routes/product-insights.mjs';
import { createRewardStatusRoutes } from '../server/routes/reward-status.mjs';
import { createProductIssueRoutes,validateIssue } from '../server/routes/product-issues.mjs';
import { handleIssueAdmin } from '../server/routes/issue-admin.mjs';
import { saveCreatorBrief } from '../server/creator-brief.mjs';
import { createCreatorSupportHandler } from '../server/creator-support.mjs';
import { activityRows,filterActivity,isActivityHidden } from '../src/features/experience/activity-model.js';
import { notificationAllowed,normalizeNotifications } from '../src/features/experience/notification-preferences.js';
import { assertTradeLimits,normalizeTradePreferences,readTradePreferences } from '../src/features/experience/trade-preferences.js';
import { createTradeExecutionController } from '../src/app/controllers/trade-execution.js';
import { createAdminRoutes } from '../server/routes/admin.mjs';
import { validatePreferenceTransfer,mergePreferences } from '../experience-preferences.js';
import { reserveFacts } from '../src/features/experience/reserve-facts.js';
import { typedSearch,candidateHref } from '../src/features/experience/search-model.js';
import { recordTradeRecovery,readTradeRecovery } from '../src/features/experience/trade-recovery-store.js';
import { recoveryItems } from '../src/features/experience/recovery-inbox.js';
import { utc } from '../src/features/experience/view-utils.js';
const mint='11111111111111111111111111111111',wallet='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B',other='So11111111111111111111111111111111111111112',source='3'.repeat(64),sig='4'.repeat(64),now=Date.parse('2026-10-30T00:00:00Z');
function fixture(){
  const launch={mint,creator:wallet,creatorWallet:wallet,cluster:'devnet',onchainVerified:true,pumpFeeRoute:{scope:'per-mint-v3',router:wallet,programId:wallet}};
  const collection={signature:source,mint,scope:'per-mint-v3',cluster:'devnet',status:'collected',onchainVerified:true,programId:wallet,router:wallet,collectedLamports:'100',recordedAt:new Date(now-30000).toISOString()};
  const state={launches:{[mint]:launch},collections:{[source]:collection},v3Settlements:{[source]:{mint,collectionSignature:source,status:'finalized',finalizedAt:new Date(now-20000).toISOString(),allocationPlan:{mint,programId:wallet,status:'allocated-not-funded',grossLamports:'100',creatorDirected:{walletLamports:'60',holderLamports:'15',xLamports:'5'},protocol:{communityLamports:'10',buybackLamports:'10'}}}},v3CreatorRewardFunding:{[source]:{status:'finalized',balanceDeltaVerified:true,finalizedAt:new Date(now-10000).toISOString()}}};
  const rewards={schedules:{one:{id:'one',mint,kind:'holder',asset:'SOL',poolIds:[`v3:${source}`],payments:{[wallet]:{status:'paid',signature:sig,amount:'15',finalized:true,balanceDeltaVerified:true,paidAt:new Date(now).toISOString()}}}}};
  return {state,rewards};
}
test('exact historical receipts are selected before the public recent-event limit',()=>{
  const {state,rewards}=fixture();for(let i=0;i<110;i++)state.collections[`recent-${i}`]={...state.collections[source],signature:'5'.repeat(64),recordedAt:new Date(now+i*1000).toISOString()};
  const result=financialReceipt(state,rewards,'devnet',sig);assert.equal(result.currentRpcRecheck,false);assert.equal(result.events.length,1);assert.equal(result.events[0].signature,sig);assert.deepEqual(result.sourceSignatures,[source]);
});
test('unlinked schedules cannot add recipients to a real receipt with the same signature',()=>{
  const {state,rewards}=fixture();rewards.schedules.unlinked={...rewards.schedules.one,poolIds:[],payments:{[other]:{...rewards.schedules.one.payments[wallet],amount:'999'}}};
  assert.deepEqual(financialReceipt(state,rewards,'devnet',sig).recipients,[{mint,wallet,amountLamports:'15',kind:'holder-paid'}]);
  state.v3CreatorRewardFunding[source].balanceDeltaVerified=false;assert.equal(financialReceipt(state,rewards,'devnet',sig),null);
});
test('a shared transaction cannot merge recipient evidence across different source mints',()=>{
  const {state,rewards}=fixture(),second='5'.repeat(64);
  state.launches[other]={...state.launches[mint],mint:other};state.collections[second]={...state.collections[source],signature:second,mint:other};
  state.v3Settlements[second]={...state.v3Settlements[source],mint:other,collectionSignature:second,allocationPlan:{...state.v3Settlements[source].allocationPlan,mint:other}};
  state.v3CreatorRewardFunding[second]={...state.v3CreatorRewardFunding[source]};rewards.schedules.two={...rewards.schedules.one,mint:other,poolIds:[`v3:${second}`]};
  assert.deepEqual(new Set(financialReceipt(state,rewards,'devnet',sig).recipients.map(row=>row.mint)),new Set([mint,other]));
});
test('cross-network and non-finalized ledgers cannot produce payment receipts',()=>{
  const {state,rewards}=fixture();assert.equal(financialReceipt(state,rewards,'mainnet-beta',sig),null);rewards.schedules.one.payments[wallet].finalized=false;assert.equal(financialReceipt(state,rewards,'devnet',sig),null);
  assert.throws(()=>financialReceipt(state,rewards,'devnet','invalid'));
});
test('recorded burn receipts stay bound to their source mint, router program and finalization',()=>{
  const {state,rewards}=fixture();state.v3BuybackOrders={[source]:{mint,programId:wallet,collectionSignature:source,status:'finalized',finalized:true,vaultDebitVerified:true,burnInstructionVerified:true,signature:'6'.repeat(64),spentLamports:'10',burnedBaseUnits:'20'}};
  assert.equal(financialReceipt(state,rewards,'devnet','6'.repeat(64)).burns[0].burnedBaseUnits,'20');
  for(const partial of [{mint:other},{programId:other},{finalized:false},{status:'queued'}]){const modified=structuredClone(state);Object.assign(modified.v3BuybackOrders[source],partial);assert.equal(financialReceipt(modified,rewards,'devnet','6'.repeat(64)),null);}
  state.v3BuybackOrders={aggregate:{...state.v3BuybackOrders[source],collectionSignature:null,sourceKind:'aggregate-collections',sourceBudgets:[]}};assert.equal(financialReceipt(state,rewards,'devnet','6'.repeat(64)),null);
});
test('engine timestamps require complete recorded funding and recipient proof',()=>{
  const {state,rewards}=fixture();let result=financialOperations(state,rewards,'devnet',now);
  assert.equal(result.timing.fundedToVerifiedHolderPayment.medianSeconds,10);assert.equal(result.retryAttempts,null);assert.equal(result.timing.fundedToVerifiedBonusPayment.samples,0);
  delete state.v3CreatorRewardFunding[source].finalizedAt;result=financialOperations(state,rewards,'devnet',now);assert.equal(result.timing.fundedToVerifiedHolderPayment.medianSeconds,null);
  result=financialOperations(state,null,'devnet',now);assert.equal(result.rewardLedgerAvailable,false);assert.match(result.coverage,/Reward ledger unavailable/);
});
function response(){const out={};out.res={writeHead(code){out.status=code;},setHeader(){},end(body){out.data=JSON.parse(body);}};return out;}
async function insight({path,cluster='devnet',verify,allowed=true,state=fixture().state,rewards=null}){
  const out=response(),handler=createProductInsightsRoutes({store:{read:async()=>state,chargeRpcRate:async()=>allowed},automaticRewardStore:{read:async()=>rewards},solanaCluster:cluster,clientKey:()=> 'fixture',solanaRpcUrl:'http://fixture.invalid',connectionFactory:()=>({}),verifyTrade:verify,respond:(res,code,body)=>{res.writeHead(code);res.end(JSON.stringify(body));}});
  await handler({method:'GET'},out.res,new URL(`http://localhost${path}`));return out;
}
test('activity never reads rewards and concurrent operations share the cached database and financial projection',async()=>{
  let states=0,rewards=0,release;
  const wait=new Promise(resolve=>{release=resolve;}),out=()=>response();
  const handler=createProductInsightsRoutes({store:{read:async()=>{states++;return {launches:{},creatorProfiles:{}};},chargeRpcRate:async()=>true},
    automaticRewardStore:{read:async()=>{throw Error('Full ledger must not be cloned');},readFinancialSnapshot:async()=>{rewards++;await wait;return {}; }},
    solanaCluster:'devnet',clientKey:()=> 'fixture',respond:(res,status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));}});
  const request=async path=>{const result=out();await handler({method:'GET'},result.res,new URL(path,'http://localhost'));return result;};
  assert.equal((await request('/api/financial/activity')).status,200);assert.equal(rewards,0);
  const first=request('/api/financial/operations'),second=request('/api/financial/operations');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(rewards,1);assert.equal(states,2);
  release();assert.equal((await first).status,200);assert.equal((await second).status,200);
  assert.equal((await request('/api/financial/operations')).status,200);assert.equal(rewards,1);assert.equal(states,2);
});
test('reward experience shares simultaneous reads only, scopes wallets and reads fresh data on the next request',async()=>{
  let reads=0,release;let wait=new Promise(resolve=>{release=resolve;});
  const handler=createRewardStatusRoutes({store:{read:async()=>({}),chargeRpcRate:async()=>true},
    automaticRewardStore:{read:async()=>{throw Error('Full ledger must not be cloned');},readFinancialSnapshot:async()=>{reads++;await wait;return {}; }},
    solanaCluster:'devnet',clientKey:()=> 'fixture',respond:(res,status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));}});
  const request=async query=>{const out=response();await handler({method:'GET'},out.res,new URL(`/api/rewards/experience${query}`,'http://localhost'));return out;};
  const first=request(`?wallet=${wallet}`),second=request(`?wallet=${wallet}`),different=request(`?wallet=${other}`);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);release();
  assert.equal((await first).data.wallet.address,wallet);assert.equal((await second).data.wallet.address,wallet);assert.equal((await different).data.wallet.address,other);
  wait=Promise.resolve();await request(`?wallet=${wallet}`);assert.equal(reads,3);
});

test('fresh trade receipt verification is read-only and distinct from recorded ledger evidence',async()=>{
  const result=await insight({path:`/api/financial/receipts/${sig}?mint=${mint}&wallet=${wallet}`,verify:async args=>{assert.equal(args.maxAgeMs,Infinity);return {side:'buy',solLamports:'50',tokenAmountRaw:'100',decimals:6,blockTime:now/1000};}});
  assert.equal(result.status,200);assert.equal(result.data.evidence,'finalized-rpc-trade');assert.equal(result.data.currentRpcRecheck,true);assert.equal(result.data.trade.wallet,wallet);
});
test('receipt RPC failure never becomes transaction failure or a verified payment',async()=>{
  const path=`/api/financial/receipts/${sig}?mint=${mint}&wallet=${wallet}`;
  const result=await insight({path,verify:async()=>{throw new Error('private provider diagnostic');}});assert.equal(result.status,503);assert.match(result.data.error,/does not establish failure/);assert.doesNotMatch(result.data.error,/private/);
  assert.equal((await insight({path,cluster:'mainnet-beta'})).status,503);assert.equal((await insight({path,allowed:false})).status,429);
});
test('public activity excludes opted-out creators and future text',async()=>{
  const state={launches:{},creatorProfiles:{'123':{id:'123',identityVerified:true,listed:true,updates:[{id:'a'.repeat(24),text:'Due',createdAt:'2026-01-01T00:00:00Z'},{id:'b'.repeat(24),text:'Future secret',createdAt:'2026-01-01T00:00:00Z',publishAt:'2099-01-01T00:00:00Z'}]},'456':{id:'456',identityVerified:true,listed:true,optedOut:true,updates:[{id:'c'.repeat(24),text:'Hidden',createdAt:'2026-01-01T00:00:00Z'}]}}};
  const result=await insight({path:'/api/financial/activity',state});assert.equal(result.status,200);assert.deepEqual(result.data.statements.map(row=>row.text),['Due']);
});
test('creator briefs preserve version history and reject unverified or excluded accounts',()=>{
  const profile={listed:true,identityVerified:true},input={purpose:'A concrete project purpose',rewards:'Signed policy',delivered:'A prototype',nextMilestone:'Test receipts'};
  assert.equal(saveCreatorBrief(profile,input).version,1);assert.equal(saveCreatorBrief(profile,{...input,delivered:'Updated prototype'}).version,2);assert.equal(profile.briefHistory[0].delivered,'A prototype');
  for(const partial of [{identityVerified:false},{optedOut:true},{listed:false}])assert.throws(()=>saveCreatorBrief({...profile,...partial},input));
  assert.throws(()=>saveCreatorBrief(profile,{...input,purpose:'x'.repeat(281)}));
});
test('activity filtering tolerates missing timestamps and requires evidence for receipts',()=>{
  const rows=activityRows([{mint,creatorWallet:wallet,onchainVerified:true,cluster:'devnet',createdTimestamp:'bad'}],{cluster:'mainnet-beta',events:[{mint,signature:sig,kind:'holder-paid',feeSourceVerified:true}]},[{mint,trader:other,signature:sig,side:'buy',blockTime:'bad'}]);
  assert.equal(rows.length,2);assert.equal(rows.find(row=>row.kind==='trade').at,null);assert.equal(filterActivity(rows,'following',new Set([wallet]),new Set()).length,1);assert.equal(filterActivity(rows,'receipt',new Set(),new Set()).length,0);
  const storage={getItem:()=>JSON.stringify(['a'.repeat(24)])};assert.equal(isActivityHidden({kind:'statement',creatorId:'123',id:`statement:${'a'.repeat(24)}`},storage),true);assert.equal(isActivityHidden({kind:'receipt',creatorId:'123',id:`statement:${'a'.repeat(24)}`},storage),false);
});
test('quiet hours cross midnight and amount thresholds use exact lamports',()=>{
  const prefs=normalizeNotifications({enabled:true,minimumSol:'0.000000002',quiet:true,start:22,end:7});
  assert.equal(notificationAllowed(prefs,'receipt','2',new Date(2026,0,1,23)),false);assert.equal(notificationAllowed(prefs,'receipt','2',new Date(2026,0,1,8)),true);assert.equal(notificationAllowed(prefs,'receipt','1',new Date(2026,0,1,8)),false);assert.equal(notificationAllowed(prefs,'receipt',null,new Date(2026,0,1,8)),false);
  assert.equal(notificationAllowed(normalizeNotifications({enabled:true,types:{launch:false}}),'launch'),false);
});
test('saved trade limits fail closed for excessive slippage, fee and unavailable fees',()=>{
  const prefs=normalizeTradePreferences({slippageCap:1,maximumNetworkSol:'0.000005'});
  assert.throws(()=>assertTradeLimits({slippagePercent:2},prefs));assert.throws(()=>assertTradeLimits({slippagePercent:1},prefs,{checkNetwork:true}));assert.throws(()=>assertTradeLimits({slippagePercent:1,networkFeeLamports:'5001'},prefs,{checkNetwork:true}));assert.doesNotThrow(()=>assertTradeLimits({slippagePercent:1,networkFeeLamports:'5000'},prefs,{checkNetwork:true}));
});
test('preference merges are explicit, bounded, public-field only and reject arbitrary keys',()=>{
  const one={version:1,wallets:[{address:wallet,roles:['creator'],secret:'excluded'}],creators:['123'],reminders:[]},two={version:1,wallets:[{address:other,roles:[]}],creators:['123','456'],reminders:[]};
  const clean=validatePreferenceTransfer(one);assert.equal(clean.wallets[0].secret,undefined);assert.equal(mergePreferences(clean,two).wallets.length,2);assert.equal(mergePreferences(clean,two).creators.length,2);assert.throws(()=>validatePreferenceTransfer({...one,privateKey:'x'}));assert.throws(()=>validatePreferenceTransfer({...one,reminders:[{id:'x',at:now,href:'https://evil.example'}]}));
});
test('reserve facts require mint, cluster and verification and keep base units exact',()=>{
  const row={mint,verified:true,totalBaseUnits:'9007199254740993000',claimedBaseUnits:'1',remainingBaseUnits:'9007199254740992999'};
  assert.equal(reserveFacts({cluster:'devnet',reserves:[row]},mint).remainingBaseUnits,row.remainingBaseUnits);assert.equal(reserveFacts({cluster:'mainnet-beta',reserves:[row]},mint),null);assert.equal(reserveFacts({cluster:'devnet',reserves:[{...row,verified:false}]},mint),null);
});
test('typed search distinguishes a wallet from a mint and blocks arbitrary navigation targets',()=>{
  const walletResult=typedSearch(wallet,[])[0],receipt=typedSearch(sig,[])[0];assert.equal(walletResult.type,'wallet');assert.equal(candidateHref(walletResult),`/wallet/${wallet}`);assert.match(candidateHref(receipt),/^\/\?receipt=/);assert.match(candidateHref({mint,href:'https://evil.example/'}),/^\/token\//);
});
test('trade recovery is wallet-scoped, persists public references and never guesses zero fees',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  assert.equal(recordTradeRecovery({walletAddress:wallet,mint,signature:sig,side:'buy',privateKey:'excluded'},storage),true);let rows=readTradeRecovery(storage);assert.equal(rows[0].feeLamports,null);assert.equal(rows[0].privateKey,undefined);assert.equal(recoveryItems(other,[],rows).length,0);assert.equal(recoveryItems(wallet,[],rows).length,1);
  recordTradeRecovery({walletAddress:wallet,mint,signature:sig,side:'buy',state:'verified'},storage);rows=readTradeRecovery(storage);assert.equal(recoveryItems(wallet,[],rows).length,0);
});
test('missing dates stay unavailable rather than becoming the Unix epoch',()=>{assert.equal(utc(null),'Time unavailable');assert.equal(utc(''),'Time unavailable');});
test('storage quota failure keeps an unresolved public signature in this tab until persistence recovers',()=>{
  const row={walletAddress:wallet,mint,signature:'7'.repeat(64),side:'sell',privateKey:'excluded'},blocked={getItem:()=> '[]',setItem(){throw new Error('quota');}};
  assert.equal(recordTradeRecovery(row,blocked),false);let saved=readTradeRecovery(blocked).find(item=>item.signature===row.signature);assert.equal(saved.state,'pending');assert.equal(saved.persisted,false);assert.equal(saved.privateKey,undefined);
  let value='[]';const healthy={getItem:()=>value,setItem:(_,next)=>{value=next;}};
  assert.equal(recordTradeRecovery({...row,state:'verified'},healthy),true);saved=readTradeRecovery(healthy).find(item=>item.signature===row.signature);assert.equal(saved.persisted,true);assert.equal(saved.state,'verified');assert.equal(JSON.stringify(saved).includes('privateKey'),false);
});
test('issue context strips query data and unknown sensitive fields',()=>{
  const row=validateIssue({category:'bug',description:'The form does not open',context:{route:'/?secret=bad',wallet,privateKey:'excluded',mint}});assert.equal(row.context.route,'/');assert.equal(row.context.privateKey,undefined);assert.equal(row.context.wallet,undefined);assert.equal(row.context.mint,mint);
});
test('guest issue reporting requires origin, returns an owner token, and status is private',async()=>{
  let state={};const store={chargeRpcRate:async()=>true,read:async()=>state,update:async fn=>fn(state)},handler=createProductIssueRoutes({store,cluster:'devnet'});
  async function request(method,path,body={},headers={}){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,headers:{host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787',...headers},socket:{remoteAddress:'127.0.0.1'}});const out=response();await handler(req,out.res,new URL(`http://127.0.0.1:8787${path}`));return out;}
  const body={category:'bug',description:'The submit button is missing'};
  assert.equal((await request('POST','/api/creator-support/issues',body,{origin:'https://evil.example'})).status,403);assert.equal(Object.keys(state).length,0);
  const submitted=await request('POST','/api/creator-support/issues',body);assert.equal(submitted.status,201);const {id,token}=submitted.data;assert.equal(state.productIssues[id].token,undefined);assert.notEqual(state.productIssues[id].tokenHash,token);
  assert.equal((await request('GET',`/api/creator-support/issues/${id}`)).status,404);
  const viewed=await request('GET',`/api/creator-support/issues/${id}`,{}, {'x-issue-token':token});assert.equal(viewed.status,200);assert.equal(viewed.data.description,undefined);assert.equal(viewed.data.tokenHash,undefined);
  const out=response();await handleIssueAdmin({method:'POST'},out.res,new URL(`http://localhost/api/admin/product-issues/${id}`),{store,body:async()=>({status:'investigating',note:'Reproduced on mobile'}),json:(res,status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));return true;}});
  assert.equal((await request('GET',`/api/creator-support/issues/${id}`,{}, {'x-issue-token':token})).data.status,'investigating');
});
test('account preference writes use the verified session and CSRF; public profiles omit them',async()=>{
  const state={creatorProfiles:{}},handler=createCreatorSupportHandler({cluster:'devnet',getSession:async()=>({user:{id:'123'},creatorCsrf:'csrf'}),store:{chargeRpcRate:async()=>true,updateCreatorProfile:async(id,fn)=>{assert.equal(id,'123');return fn(state);}}});
  const body={version:1,wallets:[],creators:['456'],reminders:[]};
  async function request(csrf){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',headers:{host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787','x-creator-csrf':csrf},socket:{}});const out=response();await handler(req,out.res,new URL('http://127.0.0.1:8787/api/creator-support/device-preferences'));return out;}
  assert.equal((await request('wrong')).status,403);assert.equal(Object.keys(state.creatorProfiles).length,0);assert.equal((await request('csrf')).data.saved,true);assert.deepEqual(state.creatorProfiles['123'].workspacePreferences.creators,['456']);
});
test('actual quote and submission controllers block saved limits before wallet submission',async()=>{
  const oldStorage=globalThis.localStorage,oldDocument=globalThis.document;
  try{
    for(const [preferences,expected] of [[{slippageCap:1,maximumNetworkSol:''},/slippage.*cap/i],[{slippageCap:10,maximumNetworkSol:'0.000005'},/Network fee is unavailable/]]){
      globalThis.localStorage={getItem:()=>JSON.stringify(preferences)};
      const messages=[],session={address:wallet,provider:{publicKey:wallet}},fields={'#trade-mint':{value:mint},'#trade-side':{value:'sell'},'#trade-amount':{value:'1'},'#trade-slippage':{value:'2'}};
      globalThis.document={querySelector:key=>fields[key]||null};
      const state={wallet:session.provider,captureWalletSession:()=>session,canSignTransactions:()=>true,parseTradeAmountInput:Number,TRADE_FEE_OWNER:wallet,connection:{},isWalletSessionCurrent:()=>true,assertWalletSessionCurrent(){},tradeInputs:()=>({mint,side:'sell',amount:1,slippagePercent:2,valid:true}),
        tradePreview:{inputKey:`${mint}:sell:1:2:${wallet}`,preparedAt:Date.now(),trade:{}},currentTradePreview:()=>state.tradePreview,getTradePreviewConnection:async()=>({}),
        setTradeStatus:message=>messages.push(message),updateTradeActionState(){},renderRoundTripAction(){},invalidateTradePreview(){},queueTradeQuote(){},submitTrade:()=>assert.fail('Must not submit when a cap blocks the trade')};
      const controller=createTradeExecutionController(state);
      if(preferences.slippageCap===1)await assert.rejects(controller.prepareTradeQuote(),expected);
      await controller.executeTrade();assert.match(messages.at(-1),expected);
    }
  }finally{globalThis.localStorage=oldStorage;globalThis.document=oldDocument;}
});
test('unreadable or corrupt saved trade limits block signing instead of silently resetting the cap',()=>{
  for(const storage of [{getItem(){throw new Error('blocked');}},{getItem:()=>'{bad JSON'}])assert.throws(()=>assertTradeLimits({slippagePercent:1},readTradePreferences(storage)),/Saved trade limits are unavailable/);
});
test('a recovered finalized failed transaction is removed from pending without a success event',async()=>{
  const priorDocument=globalThis.document,priorStorage=globalThis.localStorage;
  try{globalThis.document={querySelector:()=>null};globalThis.localStorage={getItem:()=> '[]',setItem(){}};
    const pending={signature:sig,mint,walletAddress:wallet,side:'buy'},messages=[];let controlsRefreshed=0;
    const state={pendingTradeVerifications:new Map([[sig,pending]]),captureWalletSession:()=>({address:wallet}),isWalletSessionCurrent:()=>true,updateTradeActionState:()=>controlsRefreshed++,apiRequest:async()=>({available:false}),setTradeReceiptStatus:text=>messages.push(text),assessTradeCompletion:()=>assert.fail('Failed receipts cannot be assessed as successful'),productEvent:()=>assert.fail('Failed receipts cannot emit success')};
    await createTradeExecutionController(state).verifyPendingTrade({getParsedTransaction:async()=>({meta:{err:{InstructionError:[0,'custom']}}})},sig);
    assert.equal(state.pendingTradeVerifications.size,0);assert.match(messages[0],/failed at finalized commitment/);assert.equal(controlsRefreshed,1);
  }finally{globalThis.document=priorDocument;globalThis.localStorage=priorStorage;}
});
test('admin report inventory and status routes remain behind the existing admin session',async()=>{
  let reads=0;const out=response(),handler=createAdminRoutes({store:{read:async()=>{reads++;return {};},ensureReady:async()=>{}},body:async()=>({}),respond:(res,status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));},solanaCluster:'devnet',env:{PUBLIC_APP_URL:'http://127.0.0.1:8787'}});
  for(const [method,path] of [['GET','/api/admin/product-issues'],['POST',`/api/admin/product-issues/${'a'.repeat(32)}`]]){await handler({method,headers:{origin:'http://127.0.0.1:8787'},socket:{remoteAddress:'local'}},out.res,new URL(`http://127.0.0.1:8787${path}`));assert.equal(out.status,401);}assert.equal(reads,0);
});
