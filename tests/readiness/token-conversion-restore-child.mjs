import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {prepareTokenConversionRuntime} from '../../server/token-conversion-bootstrap.mjs';
import {startApiFinancialWorkerServices} from '../../server/api-financial-workers.mjs';
import {tokenPricePolicyHash} from '../../server/token-conversion-sell-review.mjs';
import {sellReviewFixture} from './token-sell-review-fixture.mjs';

const roles=['controller','operator','price-attestation'];
const bucket='tokenConversionPriceJournalV1';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const {restoreDir,manifestPath}=JSON.parse(await readFile(process.argv[2],'utf8'));
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const f=sellReviewFixture(),events={authentication:0,custody:0,request:0,send:0};
const expected={programId:f.config.programId,programDataSha256:f.config.programDataSha256,
  policyHash:tokenPricePolicyHash(f.config),genesisHash:SOLANA_GENESIS['mainnet-beta']};
assert.deepEqual(manifest.reviewedContext,expected,'Backup witness has a different reviewed release context.');
const paths=Object.fromEntries(roles.map(role=>[role,join(restoreDir,role+'.json')]));
const raw=await Promise.all(roles.map(async role=>{
  try{return [role,await readFile(paths[role])];}catch{return [role,null];}
}));
const hashes=Object.fromEntries(raw.map(([role,bytes])=>[role,bytes?digest(bytes):null]));
const hashesMatch=roles.every(role=>hashes[role]===manifest.journalSha256[role]);
const spec={schemaVersion:1,cluster:'mainnet-beta',role:'controller',mode:'recovery-only',
  programId:f.config.programId,programDataSha256:f.config.programDataSha256,
  policyHash:tokenPricePolicyHash(f.config),
  journalReferences:Object.fromEntries(roles.map(role=>[role,'restore-journal-'+role])),
  rpcReferences:Object.fromEntries(roles.map(role=>[role,'restore-rpc-'+role])),
  authenticationReferences:Object.fromEntries(roles.map(role=>[role,'restore-auth-'+role])),
  origins:{operator:'https://restore-operator.invalid/','price-attestation':'https://restore-price.invalid/'}};
let accepted=false,error=null,page=null,attemptsMatch=false,verifiedProofs=0;
try{
  const runtime=await prepareTokenConversionRuntime({spec,policy:f.config,release:f.release,
    connectionFactory:async()=>({...f.connection,sendRawTransaction:async()=>{events.send++;throw Error('Restore cannot send.');}}),
    storeFactory:async ref=>{
      const role=roles.find(role=>spec.journalReferences[role]===ref);
      assert(role,'Unknown restored journal reference.');
      return createAutomaticRewardStore(paths[role]);
    },
    loadAuthentication:async()=>{events.authentication++;return 'a'.repeat(64);},
    loadCustody:async()=>{events.custody++;throw Error('Restore cannot load custody.');},
    request:async()=>{events.request++;throw Error('Restore cannot request a signer.');},
    now:()=>f.now});
  accepted=true;
  const selected=startApiFinancialWorkerServices({solanaCluster:'mainnet-beta',
    env:{FUNDED_OUTFLOW_ALERTS_ENABLED:'false'},preparedTokenConversionRuntime:runtime});
  assert.deepEqual(selected.started,[]);
  page=await selected.privateRecoveryWorker.tick();
  const state=await createAutomaticRewardStore(paths.controller).read();
  const attempts=state[bucket].attempts;
  attemptsMatch=digest(JSON.stringify(attempts))===manifest.controllerAttemptsSha256;
  verifiedProofs=Object.values(attempts).filter(row=>row.status==='settled'&&row.proof?.finalized===true).length;
}catch(cause){error=cause.message;}
assert.equal(events.custody,0);assert.equal(events.request,0);assert.equal(events.send,0);
process.stdout.write(JSON.stringify({accepted,error,hashesMatch,attemptsMatch,verifiedProofs,
  page:page?{attempts:page.attempts.length,remaining:page.remaining}:null,
  roleHashes:hashes,events})+'\n');
