import test from 'node:test';
import assert from 'node:assert/strict';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const kind of ['boost','listing'])test(`${kind}: sign-in supersedes a pending anonymous admin check`,async t=>{
  const events=new EventTarget(),requests=[],buttons=[];
  const wallet='admin-test-public-address';
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>requests.push(resolve)));
  const previous={document:globalThis.document,addEventListener:globalThis.addEventListener};
  globalThis.addEventListener=events.addEventListener.bind(events);
  globalThis.document={getElementById:()=>null,createElement:()=>({addEventListener(){}})};
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const anchor={after:button=>buttons.push(button)};
  let render;
  if(kind==='listing'){
    const {mountAdminListingButton}=await import('../src/features/listing/admin-listing-button.js');
    const update=mountAdminListingButton({anchor,getSession:()=>({address:wallet})});
    render=()=>update({mint:'test-mint',ready:true});
  }else{
    const {decorateAdminBoost}=await import('../src/features/boost/admin-boost-button.js');
    const app={captureWalletSession:()=>({address:wallet}),boostCheckout:{},renderExploreBoostDialog:()=>render()};
    render=()=>{buttons.length=0;decorateAdminBoost(app,{querySelector:()=>anchor});};
  }
  render();assert.equal(requests.length,1);
  events.dispatchEvent(new Event('funded:wallet-authenticated'));
  assert.equal(requests.length,2,'sign-in must start a fresh check immediately');
  requests[1](Response.json({admin:true,wallet}));await flush();await flush();
  const visible=()=>kind==='listing'?!buttons[0].hidden:buttons.length===1;
  assert.equal(visible(),true);
  requests[0](Response.json({admin:false},{status:401}));await flush();await flush();
  assert.equal(visible(),true,'late anonymous response must not hide the admin button');
  events.dispatchEvent(new Event('funded:reward-identity-change'));
  assert.equal(visible(),false,'identity changes hide the old admin privileges');
  requests[2](Response.json({admin:true,wallet:'different-wallet'}));await flush();await flush();
  assert.equal(visible(),false,'the cookie wallet must match the connected wallet');
});
