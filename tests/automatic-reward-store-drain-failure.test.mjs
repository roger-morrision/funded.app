import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAutomaticRewardStore,drainAutomaticRewardTransactions} from '../server/automatic-reward-store.mjs';

test('an active rejected ledger transaction cannot attest a successful shutdown drain',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-ledger-reject-')),path=join(directory,'ledger.json');
  let entered,finish;
  const ready=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{finish=resolve;});
  try{
    const pending=createAutomaticRewardStore(path).transaction(async()=>{entered();await hold;throw Error('Uncertain fixture result');});
    const rejected=assert.rejects(pending,/Uncertain fixture result/);
    await ready;
    const closing=assert.rejects(drainAutomaticRewardTransactions(),error=>error instanceof AggregateError&&error.errors.length===1);
    finish();await rejected;await closing;
    await assert.rejects(access(path+'.lock'),{code:'ENOENT'});
    await assert.rejects(access(path),{code:'ENOENT'});
  }finally{finish();await rm(directory,{recursive:true,force:true});}
});
