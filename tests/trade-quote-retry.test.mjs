import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradeQuoteRetry} from '../src/features/experience/trade-quote-retry.js';
function fixture(){
  const button=new EventTarget();let time=0,timer=null,current=true,calls=0;
  const ui=createTradeQuoteRetry(button,{retry:()=>calls++,isCurrent:()=>current,now:()=>time,
    setTimer:fn=>(timer=fn),clearTimer:()=>{timer=null;}});
  return {button,ui,calls:()=>calls,advance:ms=>{time=ms;timer?.();},changeIdentity:()=>{current=false;}};
}
test('failed quote exposes one explicit retry after cooldown and never retries automatically',()=>{
  const f=fixture();f.ui.failed();assert.equal(f.button.hidden,false);assert.equal(f.button.disabled,true);
  f.button.dispatchEvent(new Event('click'));assert.equal(f.calls(),0);
  f.advance(14999);assert.equal(f.button.disabled,true);f.advance(15000);assert.equal(f.button.disabled,false);
  assert.equal(f.calls(),0);f.button.dispatchEvent(new Event('click'));f.button.dispatchEvent(new Event('click'));
  assert.equal(f.calls(),1);assert.equal(f.button.hidden,true);
});
test('identity or input changes prevent stale quote retries, and reset closes the action',()=>{
  const f=fixture();f.ui.failed();f.advance(15000);f.changeIdentity();f.button.dispatchEvent(new Event('click'));
  assert.equal(f.calls(),0);f.ui.reset();assert.equal(f.button.hidden,true);assert.equal(f.button.disabled,true);
});
