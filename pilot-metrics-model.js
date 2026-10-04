const DAY = 86_400_000;
export const PILOT_STORAGE_KEY = 'funded.vip.pilot.v1';
export const PILOT_CONSENT_KEY = 'funded.vip.pilot.consent.v2';
export const PILOT_MAX_EVENTS = 2000;
export const PILOT_EVENT_NAMES = Object.freeze(['pilot-open','pilot-enrolled','draft-started','draft-reviewed','launch-review-opened','launch-submission-started','launch-confirmed','launch-review-cancelled','launch-cancelled','launch-stopped','launch-registration-pending','listing-confirmed','claim-started','claim-verified','claim-pending','claim-cancelled','claim-stopped','save-coin','follow-creator','watched-coin-view','followed-creator-view','verified-reward-view','creator-update-published','jackpot-home-view','jackpot-rewards-view','jackpot-open','jackpot-rules-view']);
const allowed = new Set(PILOT_EVENT_NAMES);
const activations = new Set(['draft-reviewed','save-coin','follow-creator','launch-confirmed','listing-confirmed','claim-verified']);
const useful = new Set(['watched-coin-view','followed-creator-view','verified-reward-view','creator-update-published','launch-confirmed','listing-confirmed','claim-verified']);
const sources = new Set(['unknown','organic','creator-invite','other','test','bot']);
const roles = new Set(['unknown','creator','community']);
const incentives = new Set(['none','offered','unknown']);
const prompts = new Set(['voluntary','reminder','unknown']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const iso = value => new Date(value).toISOString();
const ratio = (numerator,denominator) => denominator ? numerator/denominator : null;

export function normalizePilotRecord(raw) {
  if (!raw || ![undefined,1,2].includes(raw.version) || raw.consented !== true || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.participantId || '') || !Array.isArray(raw.events) || raw.events.length>PILOT_MAX_EVENTS) return null;
  const events=raw.events.filter(row=>allowed.has(row?.name) && timestamp(row.at)!==null).map(row=>({name:row.name,at:iso(timestamp(row.at)),incentive:incentives.has(row.incentive)?row.incentive:'unknown',prompt:prompts.has(row.prompt)?row.prompt:'unknown'})).sort((a,b)=>a.at.localeCompare(b.at));
  const startedAt=timestamp(raw.startedAt) ?? timestamp(events[0]?.at);
  if(startedAt===null)return null;
  const observedThrough=timestamp(raw.observedThrough) ?? timestamp(raw.exportedAt) ?? timestamp(raw.updatedAt) ?? timestamp(events.at(-1)?.at) ?? startedAt;
  const coverageEndedAt=timestamp(raw.coverageEndedAt);
  if(observedThrough<startedAt || coverageEndedAt!==null && coverageEndedAt<startedAt)return null;
  const legacyCoverageUncertain=raw.legacyCoverageUncertain===true || raw.version!==2 && raw.events.length>=300;
  return {version:2,participantId:raw.participantId.toLowerCase(),consented:true,cluster:['devnet','testnet','mainnet-beta'].includes(raw.cluster)?raw.cluster:'unknown',role:roles.has(raw.role)?raw.role:'unknown',source:sources.has(raw.source)?raw.source:'unknown',startedAt:iso(startedAt),updatedAt:iso(timestamp(raw.updatedAt)??observedThrough),observedThrough:iso(Math.min(observedThrough,coverageEndedAt??Infinity)),
    ...(coverageEndedAt===null?{}:{coverageEndedAt:iso(coverageEndedAt)}),...(legacyCoverageUncertain?{legacyCoverageUncertain:true}:{}),events:events.filter(event=>timestamp(event.at)>=startedAt)};
}

export function createPilotRecord({participantId,role,source='unknown',cluster='devnet',now=Date.now()}) {
  if(!['creator','community'].includes(role))throw new Error('Choose creator or community before enabling local recording.');
  const record=normalizePilotRecord({version:2,participantId,consented:true,role,source,cluster,startedAt:iso(now),updatedAt:iso(now),observedThrough:iso(now),events:[]});
  if(!record)throw new Error('Could not create a local pilot record.');
  return record;
}

export function appendPilotEvent(input,name,{now=Date.now(),incentive='unknown',prompt='unknown'}={}) {
  const record=normalizePilotRecord(input);
  if(!record || !allowed.has(name) || now<timestamp(record.startedAt))return record;
  if(record.coverageEndedAt)return record;
  const at=iso(now),context={incentive:incentives.has(incentive)?incentive:'unknown',prompt:prompts.has(prompt)?prompt:'unknown'};
  if(record.events.some(row=>row.name===name && (name==='creator-update-published'?row.at===at:row.at.slice(0,10)===at.slice(0,10)) && row.incentive===context.incentive && row.prompt===context.prompt))return record;
  if(record.events.length>=PILOT_MAX_EVENTS)return {...record,coverageEndedAt:record.observedThrough,updatedAt:at};
  return {...record,updatedAt:at,observedThrough:at,events:[...record.events,{name,at,...context}]};
}

// Storage is injected so consent and failure behavior can be tested without a
// browser. The separate grant prevents stale tabs from recreating revoked data.
export function createPilotRecorder({storage,now=Date.now,randomUUID=()=>crypto.randomUUID(),broadcast=()=>{}}) {
  let activeId=null,blocked=false;
  const stop=()=>{activeId=null;blocked=true;};
  function current(){
    if(blocked)return null;
    try{
      const raw=JSON.parse(storage.getItem(PILOT_STORAGE_KEY)||'null');
      const record=normalizePilotRecord(raw);
      if(!record)return null;
      let grant=storage.getItem(PILOT_CONSENT_KEY);
      if(grant===null && raw.version!==2){storage.setItem(PILOT_CONSENT_KEY,record.participantId);grant=record.participantId;}
      if(grant!==record.participantId || activeId && activeId!==record.participantId){stop();return null;}
      activeId=record.participantId;return record;
    }catch{stop();throw new Error('Device storage is unavailable. Recording and export stopped.');}
  }
  function save(record){
    try{
      if(storage.getItem(PILOT_CONSENT_KEY)!==record.participantId){stop();return null;}
      storage.setItem(PILOT_STORAGE_KEY,JSON.stringify(record));
      if(storage.getItem(PILOT_CONSENT_KEY)!==record.participantId){storage.removeItem(PILOT_STORAGE_KEY);stop();return null;}
      return record;
    }catch{stop();throw new Error('Device storage is unavailable. Recording and export stopped.');}
  }
  return {
    current,
    enable({role,source,cluster='devnet'}){
      const record=createPilotRecord({participantId:randomUUID(),role,source,cluster,now:now()});
      try{
        const raw=JSON.parse(storage.getItem(PILOT_STORAGE_KEY)||'null'),existing=normalizePilotRecord(raw),grant=storage.getItem(PILOT_CONSENT_KEY);
        if(existing && (grant===existing.participantId || grant===null && raw.version!==2)){
          if(existing.role!==record.role || existing.source!==record.source || existing.cluster!==record.cluster)throw Object.assign(new Error('A local pilot record already has a different role, source, or network. Delete it before starting a different record.'),{code:'PILOT_PROFILE_CONFLICT'});
          if(grant===null)storage.setItem(PILOT_CONSENT_KEY,existing.participantId);
          activeId=existing.participantId;blocked=false;return existing;
        }
        storage.setItem(PILOT_STORAGE_KEY,JSON.stringify(record));storage.setItem(PILOT_CONSENT_KEY,record.participantId);activeId=record.participantId;blocked=false;return record;
      }
      catch(error){if(error.code==='PILOT_PROFILE_CONFLICT')throw error;stop();throw new Error('Device storage is unavailable. Recording was not enabled.');}
    },
    record(name,context={}){const record=current();return record?save(appendPilotEvent(record,name,{...context,now:now()})):null;},
    export({observe=true}={}){const record=current();if(!record)return null;const through=Math.min(observe?now():timestamp(record.observedThrough),timestamp(record.coverageEndedAt)??Infinity);return save({...record,updatedAt:iso(now()),observedThrough:iso(through)});},
    revoke(){
      stop();try{broadcast({type:'revoked'});}catch{}
      let failed=false;
      try{storage.setItem(PILOT_CONSENT_KEY,'off');}catch{failed=true;}
      try{storage.removeItem(PILOT_STORAGE_KEY);}catch{failed=true;}
      if(failed)throw new Error('Recording stopped in this tab, but saved data could not be cleared. Close other pilot tabs and clear this site’s browser data to remove it.');
    },
    receiveRevocation:stop,
    sync(){if(blocked)return null;return current();},
  };
}

const WINDOWS=[...([1,7,30].map(day=>({key:`d${day}`,start:day,end:day+1}))),...[1,2,3,4].map(week=>({key:`week${week}`,start:1+(week-1)*7,end:1+week*7}))];
function aggregate(records,asOf){
  const result={participants:records.length,draftStarters:0,draftReviewed:0,launchReviewers:0,launchSubmitters:0,launchConfirmed:0,claimStarters:0,claimsVerified:0,activated:0,baselineUnknown:0,creatorFollowThroughEligible:0,creatorSecondUpdate:0,jackpotHomeViewers:0,jackpotRewardsViewers:0,jackpotOpeners:0,jackpotRulesReaders:0,retention:{},sustainedFourWeek:{matured:0,eligible:0,missingFollowup:0,returnedAllWeeks:0,voluntaryNoneAllWeeks:0,rate:null,voluntaryNoneRate:null,lowerBoundReturnRate:null,lowerBoundVoluntaryNoneRate:null},stageTransitions:{}};
  for(const {key} of WINDOWS)result.retention[key]={matured:0,eligible:0,missingFollowup:0,returned:0,noneReturned:0,offeredReturned:0,unknownReturned:0,voluntaryNoneReturned:0,reminderReturned:0,rate:null,voluntaryNoneRate:null,lowerBoundReturnRate:null,lowerBoundVoluntaryNoneRate:null,status:'insufficient-data'};
  const transitions=[['draftToReview','draft-started','draft-reviewed'],['reviewToSubmission','launch-review-opened','launch-submission-started'],['submissionToConfirmation','launch-submission-started','launch-confirmed'],['claimToVerified','claim-started','claim-verified']];
  for(const [key] of transitions)result.stageTransitions[key]={eligible:0,completed:0,rate:null};
  for(const record of records){
    const events=record.events.filter(row=>timestamp(row.at)<=asOf && timestamp(row.at)<=timestamp(record.observedThrough));
    const first=name=>events.find(row=>row.name===name);
    for(const [name,key] of [['draft-started','draftStarters'],['launch-review-opened','launchReviewers'],['launch-submission-started','launchSubmitters'],['launch-confirmed','launchConfirmed'],['claim-started','claimStarters'],['claim-verified','claimsVerified'],['jackpot-home-view','jackpotHomeViewers'],['jackpot-rewards-view','jackpotRewardsViewers'],['jackpot-open','jackpotOpeners'],['jackpot-rules-view','jackpotRulesReaders']])if(first(name))result[key]++;
    for(const [key,before,after] of transitions){const start=first(before);if(start){result.stageTransitions[key].eligible++;if(events.some(row=>row.name===after && row.at>=start.at))result.stageTransitions[key].completed++;}}
    if(first('draft-started') && events.some(row=>row.name==='draft-reviewed' && row.at>=first('draft-started').at))result.draftReviewed++;
    const activated=events.find(row=>activations.has(row.name));
    if(activated && record.legacyCoverageUncertain)result.baselineUnknown++;
    if(activated && !record.legacyCoverageUncertain){
      result.activated++;
      const day0=Math.floor(timestamp(activated.at)/DAY)*DAY;
      for(const window of WINDOWS){
        const cohort=result.retention[window.key],start=day0+window.start*DAY,end=day0+window.end*DAY;
        if(asOf<end)continue;cohort.matured++;
        if(timestamp(record.observedThrough)<end){cohort.missingFollowup++;continue;}
        cohort.eligible++;
        const returned=events.filter(row=>useful.has(row.name) && timestamp(row.at)>=start && timestamp(row.at)<end);
        if(returned.length)cohort.returned++;
        for(const value of ['none','offered','unknown'])if(returned.some(row=>row.incentive===value))cohort[`${value}Returned`]++;
        if(returned.some(row=>row.incentive==='none' && row.prompt==='voluntary'))cohort.voluntaryNoneReturned++;
        if(returned.some(row=>row.prompt==='reminder'))cohort.reminderReturned++;
      }
    }
    if(activated && !record.legacyCoverageUncertain){
      const day0=Math.floor(timestamp(activated.at)/DAY)*DAY,end=day0+29*DAY,sustained=result.sustainedFourWeek;
      if(asOf>=end){sustained.matured++;if(timestamp(record.observedThrough)<end)sustained.missingFollowup++;else{
        sustained.eligible++;
        const weeks=[1,2,3,4].map(week=>events.filter(row=>useful.has(row.name) && timestamp(row.at)>=day0+(1+(week-1)*7)*DAY && timestamp(row.at)<day0+(1+week*7)*DAY));
        if(weeks.every(rows=>rows.length))sustained.returnedAllWeeks++;
        if(weeks.every(rows=>rows.some(row=>row.incentive==='none' && row.prompt==='voluntary')))sustained.voluntaryNoneAllWeeks++;
      }}
    }
    const firstUpdate=first('creator-update-published');
    if(firstUpdate && !record.legacyCoverageUncertain){const end=timestamp(firstUpdate.at)+14*DAY;if(asOf>=end && timestamp(record.observedThrough)>=end){result.creatorFollowThroughEligible++;if(new Set(events.filter(row=>row.name==='creator-update-published' && row.at>=firstUpdate.at && timestamp(row.at)<=end).map(row=>row.at)).size>=2)result.creatorSecondUpdate++;}}
  }
  const sustained=result.sustainedFourWeek;sustained.rate=ratio(sustained.returnedAllWeeks,sustained.eligible);sustained.voluntaryNoneRate=ratio(sustained.voluntaryNoneAllWeeks,sustained.eligible);sustained.lowerBoundReturnRate=ratio(sustained.returnedAllWeeks,sustained.matured);sustained.lowerBoundVoluntaryNoneRate=ratio(sustained.voluntaryNoneAllWeeks,sustained.matured);
  for(const cohort of Object.values(result.retention)){cohort.rate=ratio(cohort.returned,cohort.eligible);cohort.voluntaryNoneRate=ratio(cohort.voluntaryNoneReturned,cohort.eligible);cohort.lowerBoundReturnRate=ratio(cohort.returned,cohort.matured);cohort.lowerBoundVoluntaryNoneRate=ratio(cohort.voluntaryNoneReturned,cohort.matured);cohort.status=cohort.eligible?'observed-device-cohort':'insufficient-data';}
  for(const transition of Object.values(result.stageTransitions))transition.rate=ratio(transition.completed,transition.eligible);
  for(const day of [1,7,30]){const cohort=result.retention[`d${day}`];result[`d${day}Eligible`]=cohort.eligible;result[`d${day}Returned`]=cohort.returned;result[`d${day}RetentionRate`]=cohort.rate;}
  return {...result,draftToReviewRate:ratio(result.draftReviewed,result.draftStarters),creatorFollowThroughRate:ratio(result.creatorSecondUpdate,result.creatorFollowThroughEligible)};
}

export function summarizePilot(inputs,asOf=Date.now()){
  if(!Number.isFinite(asOf) || !Array.isArray(inputs))throw new Error('Invalid pilot records or observation time.');
  const unique=new Map(),excludedIds=new Set();let invalidRecords=0,duplicateExports=0;
  for(const input of inputs){
    const record=normalizePilotRecord(input);
    if(!record || timestamp(record.startedAt)>asOf){invalidRecords++;continue;}
    if(['test','bot'].includes(record.source)){excludedIds.add(record.participantId);continue;}
    const prior=unique.get(record.participantId);
    if(prior){
      duplicateExports++;
      if(prior.role!==record.role || prior.source!==record.source || prior.cluster!==record.cluster || prior.startedAt!==record.startedAt){excludedIds.add(record.participantId);continue;}
      // A later complete snapshot is authoritative; merging old fragments can
      // invent observation coverage after deletion or a capacity limit.
      if(timestamp(record.observedThrough)>timestamp(prior.observedThrough) || timestamp(record.observedThrough)===timestamp(prior.observedThrough) && record.events.length>prior.events.length)unique.set(record.participantId,record);
    }else unique.set(record.participantId,record);
  }
  for(const id of excludedIds)unique.delete(id);
  const records=[...unique.values()];
  return {...aggregate(records,asOf),basis:'Consented local-device records, not unique people; no cross-device identity resolution.',exclusions:{invalidRecords,excludedDeviceRecords:excludedIds.size,duplicateExports},
    byCluster:Object.fromEntries(['devnet','testnet','mainnet-beta','unknown'].map(cluster=>[cluster,aggregate(records.filter(record=>record.cluster===cluster),asOf)])),
    byRole:Object.fromEntries([...roles].map(role=>[role,aggregate(records.filter(record=>record.role===role),asOf)])),
    bySource:Object.fromEntries(['creator-invite','organic','other','unknown'].map(source=>[source,aggregate(records.filter(record=>record.source===source),asOf)])),
    limitations:['Missing follow-up is unknown, not churn. Eligibility requires an export observed through the complete UTC target day.','Incentives and prompts are self-reported; unknown is never treated as none. Return classifications can overlap within a device/day.','One person may use multiple devices or re-enroll. Shared devices may represent more than one person.','Local consent can be revoked; previously shared exports require separate deletion by their recipient.']};
}
