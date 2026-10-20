import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {request,Agent} from 'node:http';
import {connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

// Windows kill(SIGTERM) terminates without delivering a POSIX signal. Execute
// these tests in the exact Linux release image for actual signal/exit evidence.
const options={skip:process.platform==='win32',timeout:10_000};
async function fixture(t,mode){
  const child=fork(new URL('./fixtures/reward-shutdown-process.mjs',import.meta.url),[mode],{
    env:{},stdio:['ignore','pipe','pipe','ipc'],
  });
  const events=[];let exited=false,output='';
  child.on('message',message=>events.push(message));
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});}));
  t.after(async()=>{if(!exited){child.kill('SIGKILL');await exit;}});
  const wait=async event=>{
    for(let i=0;i<200;i++){
      const found=events.find(item=>item.event===event);if(found)return found;
      assert.equal(exited,false,`Unexpected exit before ${event}: ${output}`);await delay(10);
    }
    throw Error(`Timed out waiting for ${event}: ${output}`);
  };
  const {port}=await wait('listening');
  const open=async(method='GET',path='/stream',agent=false)=>{
    const req=request({host:'127.0.0.1',port,path,method,agent},res=>{
      res.on('error',()=>{});res.resume();
    });
    req.on('error',()=>{});t.after(()=>req.destroy());
    const response=new Promise(resolve=>req.once('response',resolve));req.end();
    const res=await response;return {req,res};
  };
  const pending=async()=>{
    await delay(250);assert.equal(exited,false);assert.equal(events.filter(e=>e.event==='reward_ledger_drained').length,0);
  };
  const clean=async()=>{
    assert.deepEqual(await exit,{code:0,signal:null});
    assert.equal(events.filter(e=>e.event==='reward_ledger_drained').length,1);
    assert.equal(events.filter(e=>e.event==='reward_shutdown_failed').length,0);
  };
  return {child,events,wait,open,pending,clean,port};
}

test('real SIGTERM closes continuing readonly HTTP after drain and exits once',options,async t=>{
  const f=await fixture(t,'stream');await f.open();f.child.kill('SIGTERM');await f.clean();
  assert(f.events.find(e=>e.event==='drain-resolved'));
});
test('real SIGINT reaps an idle keepalive connection',options,async t=>{
  const f=await fixture(t,'idle'),agent=new Agent({keepAlive:true});t.after(()=>agent.destroy());
  const {res}=await f.open('GET','/idle',agent);if(!res.complete)await new Promise(r=>res.once('end',r));
  f.child.kill('SIGINT');await f.clean();
});
test('pending ledger blocks stream closure and repeated signals cannot bypass it',options,async t=>{
  const f=await fixture(t,'ledger'),{res}=await f.open();f.child.kill('SIGTERM');await f.wait('drain-started');
  f.child.kill('SIGTERM');f.child.kill('SIGINT');f.child.kill('SIGINT');await f.pending();
  assert.equal(res.destroyed,false);f.child.send('release-ledger');await f.clean();
});
for(const mode of ['write','write-response','get-handler'])test(`${mode} completion is preserved before ledger drain and exit`,options,async t=>{
  const f=await fixture(t,mode),{req}=await f.open(mode==='get-handler'?'GET':'POST');
  f.child.kill('SIGTERM');await f.pending();assert(!f.events.some(e=>e.event==='drain-started'));
  if(mode!=='write-response'){req.destroy();await f.pending();}
  f.child.send('release-write');await f.clean();
});
test('ledger rejection fails closed with explicit evidence and no forced readonly disconnect',options,async t=>{
  const f=await fixture(t,'ledger-failure'),{res}=await f.open();f.child.kill('SIGTERM');await f.wait('drain-started');
  f.child.send('reject-ledger');await f.wait('reward_shutdown_failed');f.child.kill('SIGTERM');await f.pending();
  assert.equal(res.destroyed,false);assert.equal(f.events.filter(e=>e.event==='reward_shutdown_failed').length,1);
  assert.equal(f.events.find(e=>e.event==='reward_shutdown_failed').stage,'ledger');
});
test('uncertain handler rejection fails closed without starting ledger drain',options,async t=>{
  const f=await fixture(t,'handler-failure');await f.open('POST');f.child.kill('SIGTERM');
  await f.wait('reward_shutdown_started');
  f.child.send('release-write');await f.wait('reward_shutdown_failed');await f.pending();
  assert(!f.events.some(e=>e.event==='drain-started'));
  assert.equal(f.events.find(e=>e.event==='reward_shutdown_failed').stage,'http-handlers');
});
test('a handler rejected before the signal cannot be forgotten while its response remains open',options,async t=>{
  const f=await fixture(t,'handler-failure');await f.open('POST');f.child.send('release-write');
  await f.wait('handler-completed');await delay(20);f.child.kill('SIGTERM');
  await f.wait('reward_shutdown_failed');await f.pending();
  assert(!f.events.some(e=>e.event==='drain-started'));
});
test('an existing socket cannot admit a new mutation after shutdown starts',options,async t=>{
  const f=await fixture(t,'ledger');
  const socket=connect(f.port,'127.0.0.1');t.after(()=>socket.destroy());let received='';
  socket.on('data',data=>received+=data);socket.on('error',()=>{});
  await new Promise(r=>socket.once('connect',r));socket.write('GET /stream HTTP/1.1\r\nHost: localhost\r\n\r\n');
  await f.wait('admitted');f.child.kill('SIGTERM');await f.wait('drain-started');
  socket.write('POST /must-not-run HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n');
  await f.pending();assert.equal(f.events.filter(e=>e.event==='admitted').length,1);
  f.child.send('release-ledger');await f.clean();assert.match(received,/HTTP\/1.1 200/);
});
