import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,access,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createAutomaticRewardStore,drainAutomaticRewardTransactions} from '../server/automatic-reward-store.mjs';

test('shutdown waits for active ledger transactions, rejects new writes, and releases the lock after commit',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-ledger-drain-')),path=join(directory,'ledger.json'),store=createAutomaticRewardStore(path);
  let enter,finish;const entered=new Promise(resolve=>{enter=resolve;}),hold=new Promise(resolve=>{finish=resolve;});
  try {
    const pending=store.transaction(async state=>{enter();await hold;state.obligations.qa={amount:'1234'};});
    await entered;let drained=false;const closing=drainAutomaticRewardTransactions().then(()=>{drained=true;});
    await assert.rejects(store.transaction(()=>assert.fail('No new transaction during shutdown')),error=>error.statusCode===503);
    assert.equal(drained,false);await access(path+'.lock');finish();await pending;await closing;
    assert.equal(drained,true);assert.equal(JSON.parse(await readFile(path,'utf8')).obligations.qa.amount,'1234');
    await assert.rejects(access(path+'.lock'),{code:'ENOENT'});
  } finally {finish();await drainAutomaticRewardTransactions();await rm(directory,{recursive:true,force:true});}
});
