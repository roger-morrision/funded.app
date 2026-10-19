import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { createLedgerRepository } from '../server/postgres/ledger.mjs';

const quote={id:'launch_service_persistence_test',payer:'qa',recipient:'treasury',amountLamports:'20000000',policyHash:'hash',revision:1,createdAt:'2026-10-19T00:00:00Z',expiresAt:'2026-10-19T00:10:00Z'};
async function roundtrip(writer,reader){
  await writer.update(state=>{state.launchServiceQuotes ||= {};state.launchServiceQuotes[quote.id]=quote;});
  // A later independent write must not discard the quote or its immutable terms.
  await writer.update(state=>{state.adminAudit.persistence={reason:'unrelated-write'};});
  assert.deepEqual((await reader.read()).launchServiceQuotes[quote.id],quote);
}
test('file store keeps launch service quotes across a new store instance',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'funded-fee-store-'));
  try{const file=join(dir,'state.json');await roundtrip(createStore(file,''),createStore(file,''));}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('Postgres ledger includes launch service quotes in independent entity writes and reads',async()=>{
  const entities=new Map();
  const client={release(){},async query(sql,args=[]){
    if(sql==='SELECT bucket, entity_key, payload FROM state_entities')return {rows:[...entities.values()]};
    if(sql.startsWith('INSERT INTO state_entities'))entities.set(args[0]+':'+args[1],{bucket:args[0],entity_key:args[1],payload:JSON.parse(args[2])});
    return {rows:[],rowCount:0};
  }};
  const repo=createLedgerRepository({pool:{connect:async()=>client},ensureReady:async()=>{}});
  await roundtrip(repo,repo);
});
test('real PostgreSQL persists service quotes across pool reconnects',{skip:!process.env.TEST_SERVICE_FEE_DATABASE_URL},async()=>{
  // Use only the dedicated disposable database provisioned for this regression.
  const url=process.env.TEST_SERVICE_FEE_DATABASE_URL;
  assert.equal(new URL(url).pathname,'/service_fee_test');
  const first=createPostgresStore(url),second=createPostgresStore(url);
  try{await roundtrip(first,second);}
  finally{await first.close();await second.close();}
});
