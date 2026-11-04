import {randomUUID} from 'node:crypto';

const phases=new Set(['deployment','lookup-table','publisher-account','state-read','custody','promotion',
  'milestone','market-observation','quote','execution','execution-proof','x-dispatch','promotion-billing','heartbeat']);
const codes={AGENCY_MARKET_NOT_MIGRATED:'awaiting-migration',AGENCY_MARKET_STALE:'market-snapshot-stale',
  AGENCY_PRICE_UNAVAILABLE:'price-reference-unavailable',AGENCY_PRICE_STALE:'price-reference-stale',
  AGENCY_LOOKUP_INACTIVE:'lookup-table-inactive',AGENCY_SIMULATION_FAILED:'simulation-failed'};
const snapshots=new WeakMap();
const object=value=>value!==null&&(typeof value==='object'||typeof value==='function');
const duration=(start,end)=>Number.isFinite(end-start)?Math.max(0,Math.round(end-start)):0;

// Never classify by message text: provider messages can contain URLs, tokens,
// signed payloads or SQL. Unknown failures intentionally remain unspecified.
export function agencyFailureCode(error){
  if(typeof error?.code==='string'&&Object.hasOwn(codes,error.code))return codes[error.code];
  if(['AbortError','TimeoutError'].includes(error?.name)||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(error?.code)
    ||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(error?.cause?.code))return 'request-timeout';
  if(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error?.code)
    ||['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error?.cause?.code))return 'network-unavailable';
  const status=error?.status;
  if(status===429)return 'provider-rate-limited';
  if(status===401)return 'provider-auth-rejected';
  if(status===402)return 'provider-credits-unavailable';
  if(status===403)return 'provider-permission-denied';
  if(Number.isInteger(status)&&status>=500&&status<=599)return 'provider-unavailable';
  return 'verification-unavailable';
}
export function agencyErrorDiagnostics(error){return object(error)?snapshots.get(error):undefined;}

export function createAgencyDiagnostics({monotonicNow=()=>performance.now(),onStep=()=>{}}={}){
  const started=monotonicNow(),cycleId=randomUUID(),steps=[],failures=new WeakMap();
  let sequence=0,droppedSteps=0;
  const emit=row=>{try{Promise.resolve(onStep({...row,cycleId})).catch(()=>{});}catch{/* Diagnostics cannot change execution. */}};
  const snapshot=()=>({version:1,cycleId,cycleDurationMs:duration(started,monotonicNow()),droppedSteps,steps:steps.map(row=>({...row}))});
  const failure=error=>object(error)&&failures.get(error)||{phase:'cycle',reasonCode:agencyFailureCode(error)};
  return{snapshot,failure,attach(error){if(object(error))snapshots.set(error,{...snapshot(),failure:{...failure(error)}});},
    async step(phase,context,action){
      const row={step:++sequence,phase:phases.has(phase)?phase:'cycle'};
      if(typeof context?.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(context.mint))row.mint=context.mint;
      if([1,2].includes(context?.agent))row.agent=context.agent;
      const at=monotonicNow();emit({...row,outcome:'started'});
      try{const value=await action();row.outcome='completed';return value;}
      catch(error){
        row.reasonCode=agencyFailureCode(error);row.outcome=row.reasonCode==='awaiting-migration'?'pending':'failed';
        // Retain a nested failure while it unwinds, but replace an earlier
        // attempt when a dependency reuses the same Error object later.
        if(object(error)&&(!failures.has(error)||failures.get(error).step<row.step))
          failures.set(error,{...row,elapsedMs:duration(at,monotonicNow())});
        throw error;
      }finally{
        row.elapsedMs=duration(at,monotonicNow());
        if(steps.length===128){steps.shift();droppedSteps++;}steps.push(row);emit({...row});
      }
    },
  };
}
