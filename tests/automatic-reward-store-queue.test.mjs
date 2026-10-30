import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';
test('shared-path ledger writers queue before acquiring the file lock and a failure does not poison later work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'funded-ledger-queue-'));
 try{
  const path=join(directory,'ledger.json'),a=createAutomaticRewardStore(path),b=createAutomaticRewardStore(path);
  let release,entered,active=0,max=0;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const first=a.transaction(async state=>{active++;max=Math.max(max,active);entered();await gate;state.counter=1;active--;});
  await started;
  const failing=b.transaction(()=>{throw new Error('Expected fixture failure');});
  const rejected=assert.rejects(failing,/fixture failure/);
  const remaining=Array.from({length:20},()=>b.transaction(state=>{active++;max=Math.max(max,active);state.counter++;active--;}));
  release();await Promise.all([first,rejected,...remaining]);
  assert.equal(max,1);assert.equal((await a.read()).counter,21);
 }finally{await rm(directory,{recursive:true,force:true});}
});
