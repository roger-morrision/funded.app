import { readFile, stat } from 'node:fs/promises';
import { summarizePilot } from '../pilot-metrics-model.js';

const args=process.argv.slice(2);
const usage='Usage: node scripts/summarize-pilot-metrics.mjs [--as-of ISO_TIMESTAMP] consented-device-export.json [...]';
try{
  let asOf=Date.now();
  if(args[0]==='--as-of'){
    if(!args[1] || !Number.isFinite(Date.parse(args[1])))throw new Error('Provide a valid --as-of timestamp.');
    asOf=Date.parse(args[1]);args.splice(0,2);
  }
  if(!args.length || args.length>1000 || args.some(value=>value.startsWith('--')))throw new Error(usage);
  const records=[];let bytes=0;
  for(let index=0;index<args.length;index++){
    try{
      const size=(await stat(args[index])).size;bytes+=size;
      if(size>1_048_576 || bytes>33_554_432)throw new Error('size');
      const value=JSON.parse(await readFile(args[index],'utf8'));
      if(Array.isArray(value))records.push(...value);else records.push(value);
      if(records.length>1000)throw new Error('records');
    }catch{throw new Error(`Export ${index+1} could not be read within the limits (1 MB each, 32 MB total, 1,000 records). No file contents were printed.`);}
  }
  const summary=summarizePilot(records,asOf),pilot=summary.byCluster.devnet;
  const nextActions=[];
  if(!pilot.participants)nextActions.push('No consented Devnet device records are available. Unknown-network legacy exports remain separate.');
  if(pilot.retention.d7.missingFollowup)nextActions.push(`${pilot.retention.d7.missingFollowup} mature Devnet device records lack D7 follow-up. They are unknown, not non-returners; use separately consented follow-up exports.`);
  if(!pilot.retention.week4.eligible)nextActions.push('A sustained four-week return result is not yet supported by a fully observed device cohort.');
  if(pilot.draftStarters>pilot.draftReviewed)nextActions.push('Review the draft-to-review drop-off with consenting participants; these event counts do not establish its cause.');
  nextActions.push('Report observed denominators, missing follow-up and conservative lower bounds together. Treat rates as descriptive, not representative of unique people.');
  console.log(JSON.stringify({observedAt:new Date(asOf).toISOString(),sharing:'Analyze only exports whose owners separately consented to sharing. No upload occurs in this CLI.',evidenceStatus:pilot.participants?'descriptive-local-device-evidence':'insufficient-data',devnetPilot:pilot,...summary,nextActions},null,2));
}catch(error){console.error(error.message);process.exitCode=2;}
