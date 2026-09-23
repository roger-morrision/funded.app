// Explicit synthetic browser QA only. Never use an app database or real identity.
if(process.env.FUNDED_FOLLOWING_FIXTURE!=='1'||process.env.NODE_ENV!=='test'||!process.env.FUNDED_STORE_PATH||process.env.DATABASE_URL)throw new Error('Isolated following fixture required.');
const {createStore}=await import('../../server/store.mjs');
await createStore(process.env.FUNDED_STORE_PATH,'').update(state=>{
  state.creatorProfiles={};
  for(let n=100;n<145;n++)state.creatorProfiles[String(n)]={id:String(n),handle:`@fixture${n}`,name:`Synthetic creator ${n}`,listed:true,identityVerified:true,
    updates:[{id:String(n).padStart(24,'0'),text:'Synthetic update for pagination QA only. No actual creator, fee or payout.',createdAt:'2026-09-21T00:00:00Z'}]};
});
globalThis.fetch=async()=>{throw new Error('External network is disabled in following QA.');};
await import('../../server/index.mjs');
