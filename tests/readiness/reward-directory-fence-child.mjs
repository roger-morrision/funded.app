import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname,sep} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
assert.equal(process.platform,'linux','Directory fence evidence requires actual Linux.');
const root=fs.realpathSync(process.env.FUNDED_DIRECTORY_FENCE_ROOT||'/app/data');
const mode=process.argv[2],base=fs.mkdtempSync(join(root,'directory-fence-')),path=join(base,'new-parent','new-child','ledger.json');
const identity=s=>createHash('sha256').update(JSON.stringify(Object.values(s.schedules||{}).map(p=>[p.id,p.manifest?.root,p.payoutAttempts,p.payments]))).digest('hex');
const realOpen=fs.promises.open,realRename=fs.promises.rename,events=[];let armed=false,renamed=false;
fs.promises.open=async function(p,...args){
  const name=String(p),directory=args[0]==='r'&&(name===root||name.startsWith(root+sep));
  if(armed&&mode==='open-fail'&&directory)throw Object.assign(Error('DIR_OPEN_FAILURE'),{code:'EACCES'});
  const handle=await realOpen(p,...args),isDirectory=(await handle.stat()).isDirectory(),sync=handle.sync,close=handle.close;
  handle.sync=async function(){
    events.push([isDirectory?'dir-sync-start':'file-sync-start',name]);
    if(armed&&mode==='combined'&&name.endsWith('.tmp'))throw Error('FILE_SYNC_FAILURE');
    if(armed&&isDirectory&&['post-rename','combined','primary-and-fence'].includes(mode)){
      if(mode==='post-rename')armed=false;throw Error('DIR_SYNC_FAILURE');
    }
    await sync.call(handle);events.push([isDirectory?'dir-sync-done':'file-sync-done',name]);
  };
  handle.close=async function(){await close.call(handle);
    if(armed&&mode==='combined'&&name.endsWith('.tmp'))throw Error('FILE_CLOSE_FAILURE');
    if(armed&&mode==='close-fail'&&isDirectory)throw Error('DIR_CLOSE_FAILURE');
    if(armed&&mode==='lock-close'&&name.endsWith('.lock'))throw Error('LOCK_CLOSE_FAILURE');
  };return handle;
};
fs.promises.rename=async function(a,b){await realRename(a,b);renamed=true;events.push(['renamed',String(b)]);};
syncBuiltinESMExports();
const {createAutomaticRewardStore}=await import('../../server/automatic-reward-store.mjs');
const store=createAutomaticRewardStore(path),messages=e=>[e.message,...(e.errors||[]).flatMap(messages)];
let dependent=0;
try{
  if(mode==='bootstrap'){
    await store.transaction(s=>{s.schedules.original={payoutAttempts:{recipient:{signature:'original',state:'prepared'}}};});events.push(['returned']);
    for(const d of [dirname(path),dirname(dirname(path)),base])assert(events.some(e=>e[0]==='dir-sync-done'&&e[1]===d),d);
    assert(events.findIndex(e=>e[0]==='file-sync-done')<events.findIndex(e=>e[0]==='renamed'));
    assert(events.findIndex(e=>e[0]==='renamed')<events.findIndex(e=>e[0]==='dir-sync-done'));
    assert(events.findIndex(e=>e[0]==='dir-sync-done')<events.findIndex(e=>e[0]==='returned'));
  }else if(mode==='journal'){
    const {historicalPayoutFixture}=await import('./reward-payout-fixture.mjs'),f=historicalPayoutFixture();f.autoLand=false;f.proofAvailable=false;
    await store.transaction(s=>{s.schedules[f.plan.id]=f.plan;});armed=true;
    // Trigger the real post-rename directory failure for the first signed wire.
    const priorOpen=fs.promises.open;fs.promises.open=async function(p,...args){const h=await priorOpen(p,...args);
      if(armed&&args[0]==='r'&&String(p).startsWith(base)){const sync=h.sync;h.sync=async function(){armed=false;throw Error('SIGNED_WIRE_DIR_SYNC_FAILURE');};}
      return h;};syncBuiltinESMExports();
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}).then(()=>{dependent++;}));
    const other=createAutomaticRewardStore(path),saved=(await other.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient];
    assert.equal(saved.state,'prepared');assert.equal(f.sends,0);assert.equal(f.latestCalls,1);assert.equal(dependent,0);
    await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store:other,recoveryOnly:true}),/exact finalized reconciliation/);
    assert.equal((await other.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient].signature,saved.signature);
    assert.equal(f.sends,0);assert.equal(f.latestCalls,1);
  }else{
    await store.transaction(s=>{s.schedules.original={id:'original',payoutAttempts:{recipient:{signature:'original',state:'prepared'}}};});
    if(mode==='migration'){const s=JSON.parse(fs.readFileSync(path));s.version=1;fs.writeFileSync(path,JSON.stringify(s));}
    const original=identity(await store.read()),inode=fs.statSync(path,{bigint:true}).ino,bytes=fs.readFileSync(path);await store.readStatusSnapshot();events.length=0;renamed=false;armed=true;
    if(mode==='noop'||mode==='migration'){
      assert.equal(await store.transaction(()=>false),false);events.push(['returned']);assert(events.some(e=>e[0]==='dir-sync-done'));
      if(mode==='noop'){assert(!renamed);assert.equal(fs.statSync(path,{bigint:true}).ino,inode);assert(fs.readFileSync(path).equals(bytes));}
      else{assert(renamed);assert.equal((await store.read()).version,2);}
    }else{
      let error;const primary=Object.assign(Error('PRIMARY_MUTATION_FAILURE'),{statusCode:409});
      try{await store.transaction(s=>{if(mode==='primary-and-fence')throw primary;s.schedules.original.note='published';}).then(()=>{dependent++;});}catch(e){error=e;}
      assert(error);assert.equal(dependent,0);const all=messages(error);
      if(mode==='primary-and-fence'){assert.equal(error.cause,primary);assert.equal(error.statusCode,409);assert(all.includes(primary.message)&&all.includes('DIR_SYNC_FAILURE'));}
      if(mode==='combined')for(const m of ['FILE_SYNC_FAILURE','FILE_CLOSE_FAILURE','DIR_SYNC_FAILURE'])assert(all.includes(m),m);
      if(mode==='open-fail')assert(all.includes('DIR_OPEN_FAILURE'));
      if(mode==='close-fail')assert(all.includes('DIR_CLOSE_FAILURE'));
      if(mode==='lock-close')assert(all.includes('LOCK_CLOSE_FAILURE'));
      if(mode==='post-rename'){
        assert(renamed&&all.includes('DIR_SYNC_FAILURE'));const other=createAutomaticRewardStore(path);
        assert.equal((await other.read()).schedules.original.note,'published');assert.equal((await store.readStatusSnapshot()).schedules.original.note,'published');
      }
      assert.equal(identity(await createAutomaticRewardStore(path).read()),original);
      assert.equal(fs.existsSync(path+'.lock'),mode==='lock-close');
      if(mode==='lock-close')fs.unlinkSync(path+'.lock'); // Known closed injected handle; test cleanup only.
    }
  }
  console.log(JSON.stringify({mode,dependent,events,platform:process.platform,filesystem:fs.statfsSync(base).type.toString(16)}));
}finally{fs.rmSync(base,{recursive:true,force:true});}
