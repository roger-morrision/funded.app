import {DEFAULT_SERVICE_FEES} from '../../service-fees.js';
export const ADMIN='CG87C9tjCSB9BAoKfoPUM3mLvbg3WAK1NGNQCWi12zcJ';
export const SOURCE='7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
export const overview=source=>({wallets:source?[{role:'QA external treasury',address:source,custody:'external wallet',withdrawable:true,lamports:'2000000000'}]:[],
 withdrawalDestinations:[ADMIN],revenue:{verifiedCollectionsLamports:'0',operationsAllocationLamports:'0',finalizedSettlementCount:0},gates:{collection:true}});
export function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
export async function adminFixture(page,override=()=>false,{wallet=true,expiresMs=120000}={}){
 const state={source:SOURCE,signedIn:true,requests:[]};
 if(wallet)await page.addInitScript(address=>{window.solana={publicKey:{toBase58:()=>address},connect:async()=>{},signMessage:async()=>({signature:new Uint8Array(64)}),on:()=>{}};},ADMIN);
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),send=(status,value)=>route.fulfill({status,json:value});
  state.requests.push({path,method});if(await override({route,path,method,send,state}))return;
  if(path==='/api/admin/session'&&method==='GET')return send(state.signedIn?200:401,state.signedIn?{wallet:ADMIN,expiresAt:new Date(Date.now()+expiresMs).toISOString()}:{error:'Sign in.'});
  if(path==='/api/admin/session'){state.signedIn=true;return send(200,{wallet:ADMIN,expiresAt:new Date(Date.now()+expiresMs).toISOString()});}
  if(path==='/api/admin/challenge')return send(200,{nonce:'labeled-fixture',message:'Labeled QA sign-in fixture'});
  if(path==='/api/admin/logout'){state.signedIn=false;return send(200,{signedOut:true});}
  if(path==='/api/fee-policy')return send(200,{revision:1,split:{operationsPercent:40,referralLevelPercents:[10,3,2],communityPercent:20,buybackPercent:25}});
  if(path==='/api/admin/overview')return send(200,overview(state.source));
  if(path==='/api/admin/audit')return send(200,{entries:[]});
  if(path==='/api/admin/service-fees')return send(200,{revision:0,hash:'a'.repeat(64),policy:DEFAULT_SERVICE_FEES});
  if(path==='/api/admin/x-posts')return send(200,{safety:{paused:true,reason:'QA only'},events:[],nextCursor:null});
  if(path==='/api/daily-bonus')return send(200,{cluster:'devnet',snapshots:[],schedule:{mode:'daily',periodSeconds:86400}});
  if(path==='/api/admin/financial-health')return send(200,{checkedAt:new Date().toISOString(),counts:{flows:3,alerts:0},alerts:[]});
  if(path==='/api/admin/rpc-health')return send(200,{enabled:true,verified:true,checkedAt:new Date().toISOString(),redis:{enabled:true,ready:true},counts:{upstreamRequests:40,redisCacheHits:10,coalescedReads:10,accountBatchSavings:20,rateLimited:0,queueRejected:2},memoryCacheHits:20,avoidedProviderAttempts:60,scope:'Gateway counters since its last restart; request attempts, not billed credits.'});
  if(path==='/api/admin/vaults')return send(200,{vaults:[],totalLaunches:0,nextOffset:null});
  return send(503,{error:'Labeled fixture: this action is not available.'});
 });return state;
}
