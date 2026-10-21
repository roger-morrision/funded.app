import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketingAgencyRoutes} from '../server/routes/marketing-agency.mjs';
import {AGENCY_DEVNET_PROGRAM} from '../server/agency-release.mjs';
import {AGENCY_RECEIPT_PROGRAM,AGENCY_RECEIPT_SCOPE} from '../config/agency-history.js';
import {allocationAuditHash} from '../server/allocation-audit-hash.mjs';

const programId=AGENCY_RECEIPT_PROGRAM,mint='So11111111111111111111111111111111111111112',hash='a'.repeat(64);
function fixture(){
  const rows=[1,2].map(agent=>{
    const signature=String(agent+2).repeat(88),row={status:'finalized',signature,signedTransaction:'PRIVATE-JOURNAL',
      intent:{programId,approvedHash:hash,mint,agent},evidence:{agencyExecution:{agent,rules:{marketCapUsd:[1,2],communityWindowSeconds:7776000,promotionIntervalSeconds:86400}}},
      proof:{signature,sourceMint:mint,agent,category:7,agencyPolicy:true,burnInstructionVerified:true,vaultDebitVerified:true,
        finalized:true,balanceDeltaVerified:true,amount:'25502',burnedAt:`2026-10-21T05:04:${agent===1?'37':'57'}.000Z`}};
    row.intentHash=allocationAuditHash(row.intent);row.evidenceHash=allocationAuditHash(row.evidence);return row;
  });
  return{state:{v3AgencyExecutions:Object.fromEntries(rows.map((row,i)=>[i,row]))},env:{FUNDED_V3_AGENCY_ENABLED:'true',FUNDED_V3_AGENCY_BUYBACK_ENABLED:'true',
    FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,FUNDED_V3_PROGRAM_DATA_SHA256:hash,FUNDED_BUILD_ID:'b'.repeat(40),X_POST_ENABLED:'false',X_POST_ACCOUNT_STATUS:'suspended'}};
}
async function response(f,{ready=false,throws=false,missing=false}={}){
  let result;
  const route=createMarketingAgencyRoutes({env:f.env,store:{read:async()=>{if(f.storeError)throw Error('Store unavailable');return f.state;}},
    readLaunchConfig:missing?undefined:async()=>{if(throws)throw Error('Verification unavailable');return{ready,reasons:['Current verification unavailable'],
      agency:{configRevision:'4'},programId,protocolSplit:{agencyPercent:10,operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25}};},respond:(_res,status,body)=>result={status,body}});
  await route({method:'GET'},{},new URL('https://funded.vip/api/marketing-agency'));return result;
}

test('historical public context matches the existing reviewed Devnet program',()=>assert.equal(AGENCY_RECEIPT_PROGRAM,AGENCY_DEVNET_PROGRAM));
test('unchanged finalized receipts remain visible across ready, stale, verification failure, missing config and recovery',async()=>{
  const f=fixture(),before=structuredClone(f.state),cases=[];
  for(const options of [{ready:true},{ready:false},{throws:true},{missing:true},{ready:true}]){
    const {status,body}=await response(f,options);assert.equal(status,200);assert.equal(body.history.length,2);
    assert.deepEqual(body.history.map(x=>x.savedMarketCapUsd).sort(),[1,2]);
    if(options.ready!==true){assert.equal(body.active,false);assert.equal(body.executionEnabled,false);assert.equal(body.funding.collectedLamports,null);assert.equal(body.funding.spentLamports,null);assert.equal(body.historyVerification.scope,AGENCY_RECEIPT_SCOPE);assert.equal(body.publishingPaused,true);assert(body.agents.every(x=>!x.enabled));}
    else{assert.equal(body.active,true);assert.equal(body.executionEnabled,true);}
    assert(!JSON.stringify(body).includes('PRIVATE-JOURNAL'));cases.push(body.history);
  }
  for(const rows of cases)assert.deepEqual(rows,cases[0]);assert.deepEqual(f.state,before);
});
test('missing or wrong reviewed pins and unavailable/malformed storage cannot establish historical availability',async()=>{
  for(const mutate of [f=>delete f.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,f=>f.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID=mint,
    f=>delete f.env.FUNDED_V3_PROGRAM_DATA_SHA256,f=>f.env.FUNDED_V3_PROGRAM_DATA_SHA256='bad',f=>f.env.FUNDED_V3_PROGRAM_DATA_SHA256='c'.repeat(64),f=>delete f.state.v3AgencyExecutions,
    f=>f.state.v3AgencyExecutions=[],f=>f.state=null,f=>f.storeError=true]){
    const f=fixture();mutate(f);const {body}=await response(f);assert.equal(body.historyStatus,'unavailable');assert.deepEqual(body.history,[]);assert.equal(body.active,false);
  }
  const f=fixture();f.state.v3AgencyExecutions={};const {body}=await response(f);assert.equal(body.historyStatus,'worker-recorded-finalized');assert.deepEqual(body.history,[]);
});
test('wrong program/hash, unfinalized and mismatched signature/proof rows are not earlier verified history',async()=>{
  for(const mutate of [r=>r.intent.programId=mint,r=>r.intent.approvedHash='c'.repeat(64),r=>r.status='submitted',r=>r.proof.finalized=false,
    r=>r.proof.balanceDeltaVerified=false,r=>r.proof.signature='different',r=>{r.signature='bad';r.proof.signature='bad';},r=>r.intent.agent=99]){
    const f=fixture();for(const row of Object.values(f.state.v3AgencyExecutions))mutate(row);const {body}=await response(f);assert.deepEqual(body.history,[]);assert.equal(body.historyStatus,'unavailable');assert.equal(body.active,false);
  }
});
test('legacy/mismatched numeric provenance stays neutral without losing matching finalized receipts',async()=>{
  for(const mutate of [r=>delete r.evidence,r=>r.proof.sourceMint=mint.slice(0,-1)+'1',r=>r.proof.category=6,r=>r.proof.agent=0,
    r=>r.evidence.agencyExecution.rules.marketCapUsd=[100000,300000],r=>r.proof.vaultDebitVerified=false]){
    const f=fixture();for(const row of Object.values(f.state.v3AgencyExecutions))mutate(row);const {body}=await response(f);assert.equal(body.history.length,2);assert(body.history.every(x=>x.savedMarketCapUsd===null));
  }
});
test('historical projection is independent from malformed current budget/launch fields and strips raw journals',async()=>{
  const f=fixture();f.state.launches={bad:null};f.state.adminSettings={agencyBudgets:{bad:{paidLamports:'secret-unverified-balance'}}};
  f.state.v3AgencyExecutions.invalid=null;const {body}=await response(f);assert.equal(body.history.length,2);assert(!JSON.stringify(body).includes('secret-unverified-balance'));assert(!JSON.stringify(body).includes('PRIVATE-JOURNAL'));
});
