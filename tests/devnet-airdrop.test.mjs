import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import bs58 from 'bs58';

// Execute the actual UI handler with synthetic dependencies, not a copied implementation.
// These are offline control-flow tests, not native wallet or on-chain acceptance tests.
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('async function requestAirdrop(){');
assert.ok(start>0);
const source=app.slice(app.lastIndexOf('\n}',start)+2,app.indexOf('async function launchToken(){',start));
const signature=bs58.encode(new Uint8Array(64).fill(1));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture({confirmation={value:{err:null}},cluster='devnet',connected=true}={}){
  const events=[],button={disabled:false},session={address:'synthetic-wallet',provider:{publicKey:'synthetic-wallet'}};
  let current=true;
  const context={bs58,APP_CLUSTER:cluster,wallet:connected?session.provider:null,
    document:{querySelector:selector=>{assert.equal(selector,'#airdrop-button');return button;}},
    captureWalletSession:()=>context.wallet?session:null,
    isWalletSessionCurrent:()=>current,
    assertWalletSessionCurrent:()=>{if(!current)throw new Error('Wallet changed');},
    getSolana:async()=>({LAMPORTS_PER_SOL:1_000_000_000}),
    connectWallet:async()=>{events.push({kind:'connect'});context.wallet=session.provider;},
    setLaunchStatus:(message,error)=>events.push({kind:'status',message,error}),
    setLaunchLinks:(message,links,error)=>events.push({kind:'links',message,links,error}),
    refreshWalletInfo:async()=>{events.push({kind:'refresh'});},
    explorer:path=>`https://explorer.solana.com/${path}?cluster=devnet`,
    connection:{requestAirdrop:async(key,amount)=>{events.push({kind:'request',key,amount});return signature;},confirmTransaction:async(sig,commitment)=>{events.push({kind:'confirm',signature:sig,commitment});return confirmation;}},
    console};
  vm.runInNewContext(source,context);
  return{context,events,button,session,run:()=>context.requestAirdrop(),switchWallet:()=>{current=false;},of:kind=>events.filter(event=>event.kind===kind)};
}
function proof(f){const rows=f.of('links');assert.ok(rows.length);const row=rows.at(-1);assert.equal(row.links.length,1);assert.equal(row.links[0].href,`https://explorer.solana.com/tx/${signature}?cluster=devnet`);return row;}
function noSuccess(f){assert.equal(f.of('refresh').length,0);assert.ok(!f.events.some(row=>row.message==='Airdrop confirmed.'));}

test('only explicit successful confirmation reports Devnet airdrop confirmed and refreshes balance',async()=>{
  const f=fixture();await f.run();assert.equal(proof(f).message,'Airdrop confirmed.');assert.equal(f.of('refresh').length,1);assert.equal(f.of('request').length,1);assert.equal(f.of('request')[0].amount,1_000_000_000);assert.equal(f.of('confirm')[0].commitment,'confirmed');assert.equal(f.button.disabled,false);
  await f.run();assert.equal(f.of('request').length,2,'completed request releases the guard for a deliberate retry');
});

test('confirmed execution error retains its Explorer proof without success or balance refresh',async()=>{
  const f=fixture({confirmation:{value:{err:{InstructionError:[0,{Custom:1}]}}}});await f.run();assert.match(proof(f).message,/failed/i);noSuccess(f);assert.equal(f.of('request').length,1);assert.equal(f.button.disabled,false);
});

test('missing and malformed confirmation responses retain an unknown outcome instead of claiming success',async()=>{
  for(const confirmation of [null,undefined,{}, {value:null},{value:{}},{value:{err:undefined}}, {value:'malformed'}]){
    const f=fixture();f.context.connection.confirmTransaction=async()=>confirmation;await f.run();assert.match(proof(f).message,/unknown|not confirmed|could not.*confirm/i);noSuccess(f);assert.equal(f.of('request').length,1);assert.equal(f.button.disabled,false);
  }
});

test('post-signature confirmation timeout preserves proof and never redirects to another faucet request',async()=>{
  const f=fixture();f.context.connection.confirmTransaction=async()=>{throw new Error('429 faucet timed out');};await f.run();assert.match(proof(f).message,/unknown|not confirmed|could not.*confirm/i);noSuccess(f);assert.ok(!f.of('links').flatMap(row=>row.links).some(link=>link.href==='https://faucet.solana.com/'));assert.equal(f.of('request').length,1);
});

test('pre-signature rejection offers truthful recovery while transport ambiguity never claims chain failure',async()=>{
  for(const message of ['429 rate limit','network timed out']){
    const f=fixture();f.context.connection.requestAirdrop=async()=>{f.events.push({kind:'request'});throw new Error(message);};await f.run();noSuccess(f);assert.equal(f.of('confirm').length,0);assert.equal(f.of('request').length,1);assert.equal(f.button.disabled,false);assert.ok(f.events.some(row=>row.message&&/unavailable|unknown|could not|not.*confirm|limit/i.test(row.message)));assert.ok(!f.events.some(row=>row.message==='Airdrop failed: network timed out'));
  }
});

test('non-Devnet networks never connect a wallet or request faucet funds',async()=>{
  for(const cluster of ['mainnet-beta','testnet']){const f=fixture({cluster,connected:false});await f.run();assert.equal(f.of('connect').length,0);assert.equal(f.of('request').length,0);noSuccess(f);assert.equal(f.button.disabled,false);}
});

test('a second invocation during connection cannot start a duplicate request',async()=>{
  const f=fixture({connected:false}),gate=deferred();f.context.connectWallet=async()=>{f.events.push({kind:'connect'});await gate.promise;f.context.wallet=f.session.provider;};const first=f.run();assert.equal(f.button.disabled,true);await f.run();assert.equal(f.of('connect').length,1);gate.resolve();await first;assert.equal(f.of('request').length,1);assert.equal(f.button.disabled,false);
});

test('connection cancellation and rejection release the busy guard for a later explicit attempt',async()=>{
  for(const rejects of [false,true]){const f=fixture({connected:false});f.context.connectWallet=async()=>{if(rejects)throw new Error('User rejected connection');};await f.run();assert.equal(f.of('request').length,0);assert.equal(f.button.disabled,false);f.context.connectWallet=async()=>{f.context.wallet=f.session.provider;};await f.run();assert.equal(f.of('request').length,1);assert.equal(proof(f).message,'Airdrop confirmed.');}
});

for(const phase of ['SDK','request','confirmation'])test(`wallet change during ${phase} wait suppresses stale outcomes`,async()=>{
  const f=fixture(),gate=deferred();
  if(phase==='SDK')f.context.getSolana=()=>gate.promise;
  if(phase==='request')f.context.connection.requestAirdrop=()=>{f.events.push({kind:'request'});return gate.promise;};
  if(phase==='confirmation')f.context.connection.confirmTransaction=()=>{f.events.push({kind:'confirm'});return gate.promise;};
  const pending=f.run();await new Promise(resolve=>setImmediate(resolve));f.switchWallet();const before=f.events.length;gate.resolve(phase==='SDK'?{LAMPORTS_PER_SOL:1e9}:phase==='request'?signature:{value:{err:null}});await pending;
  assert.equal(f.events.slice(before).filter(row=>['status','links','refresh'].includes(row.kind)).length,0);if(phase==='SDK')assert.equal(f.of('request').length,0);assert.equal(f.button.disabled,false);
});

test('balance refresh failure cannot downgrade a confirmed transaction',async()=>{
  const f=fixture();f.context.refreshWalletInfo=async()=>{throw new Error('Balance RPC timed out');};await f.run();await new Promise(resolve=>setImmediate(resolve));assert.match(proof(f).message,/^Airdrop confirmed/);assert.match(proof(f).message,/balance could not be refreshed/);assert.ok(f.of('links').every(row=>row.message.startsWith('Airdrop confirmed')));assert.equal(f.of('request').length,1);assert.equal(f.button.disabled,false);
});

test('missing or malformed faucet signatures remain unknown without creating a fabricated transaction link',async()=>{
  for(const value of [null,'',{},'not-base58',' '+signature,signature+'?cluster=mainnet-beta','../'+signature,'1',bs58.encode(new Uint8Array(65).fill(1))]){const f=fixture();f.context.connection.requestAirdrop=async()=>value;await f.run();noSuccess(f);assert.equal(f.of('confirm').length,0);const notice=f.of('links').at(-1);assert.match(notice.message,/unknown/);assert.equal(notice.links[0].href,'https://explorer.solana.com/address/synthetic-wallet?cluster=devnet');assert.equal(f.button.disabled,false);}
});
