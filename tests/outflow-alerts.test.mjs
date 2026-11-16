import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {createOutflowWatcher,watchedWallets,programVaults} from '../server/outflow-alerts.mjs';

const SOL=1_000_000_000;
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

function harness({programId=null,expectedAuthority=null}={}){
  let state={},time=Date.parse('2026-11-16T00:00:00Z');
  const balances=new Map(),accounts=new Map(),sent=[];
  const store={read:async()=>structuredClone(state),update:async fn=>{const next=structuredClone(state);const out=fn(next);state=next;return out;}};
  const rpc={getMultipleAccountsInfo:async keys=>keys.map(k=>accounts.get(k.toBase58())||(balances.has(k.toBase58())?{lamports:balances.get(k.toBase58())}:null)),
    getAccountInfo:async k=>accounts.get(k.toBase58())||null};
  const wallets=[{address:Keypair.generate().publicKey.toBase58(),role:'Trading fee treasury'}];
  const watcher=createOutflowWatcher({store,connection:()=>rpc,programId,expectedAuthority,env:{},now:()=>time,logger:{},
    accounts:async()=>watchedWallets({env:{},roles:()=>wallets}),sendAlert:async alert=>sent.push(alert)});
  return{watcher,balances,accounts,sent,wallet:wallets[0].address,state:()=>state,advance:ms=>{time+=ms;}};
}

test('a large drop in one check and a large 24-hour total each send one alert',async()=>{
  const h=harness();
  h.balances.set(h.wallet,20*SOL);await h.watcher.check();
  assert.equal(h.sent.length,1,'first check sends only the started notice');assert.match(h.sent[0].subject,/started/);h.sent.length=0;
  h.balances.set(h.wallet,18.5*SOL);h.advance(300_000);await h.watcher.check();
  assert.equal(h.sent.length,1);assert.match(h.sent[0].lines[0],/Trading fee treasury.*1\.5 SOL left/);
  for(let i=0;i<5;i++){h.balances.set(h.wallet,h.balances.get(h.wallet)-0.9*SOL);h.advance(300_000);await h.watcher.check();}
  assert.equal(h.sent.length,2,'small drops add up to the daily alert');assert.match(h.sent[1].lines[0],/last 24 hours/);
  h.balances.set(h.wallet,h.balances.get(h.wallet)-0.5*SOL);h.advance(300_000);await h.watcher.check();
  assert.equal(h.sent.length,2,'daily alert is sent once per 24 hours');
  h.balances.set(h.wallet,50*SOL);h.advance(300_000);await h.watcher.check();
  assert.equal(h.sent.length,2,'inflows never alert');
  assert.equal(Object.keys(h.state().outflowAlerts).length,2);
});

test('a router or upgrade authority change alerts',async()=>{
  const programId=Keypair.generate().publicKey,authority=Keypair.generate().publicKey.toBase58(),attacker=Keypair.generate().publicKey;
  const h=harness({programId:programId.toBase58(),expectedAuthority:authority});
  const router=PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')],programId)[0].toBase58();
  const programData=Keypair.generate().publicKey;
  const routerData=who=>{const data=Buffer.alloc(74);new PublicKey(who).toBuffer().copy(data,41);return{lamports:1,data};};
  const upgradeData=who=>{const data=Buffer.alloc(45);data[12]=1;new PublicKey(who).toBuffer().copy(data,13);return{lamports:1,data};};
  const programAccount=Buffer.alloc(36);programData.toBuffer().copy(programAccount,4);
  h.accounts.set(programId.toBase58(),{lamports:1,owner:LOADER,data:programAccount});
  h.accounts.set(router,routerData(authority));h.accounts.set(programData.toBase58(),upgradeData(authority));
  h.balances.set(h.wallet,SOL);
  await h.watcher.check();assert.equal(h.sent.length,1);h.sent.length=0;
  h.accounts.set(router,routerData(attacker));h.accounts.set(programData.toBase58(),upgradeData(attacker));
  await h.watcher.check();
  assert.equal(h.sent.length,1);
  const text=h.sent[0].lines.join('\n');
  assert.match(text,/Fee router authority changed/);assert.match(text,/Program upgrade authority changed/);assert.match(text,/no longer this server's configured authority/);
});

test('program vaults are grouped per mint',()=>{
  const programId=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();
  const rows=programVaults({programId,authority:Keypair.generate().publicKey.toBase58(),mints:[mint]});
  assert.equal(rows.length,9);assert.equal(new Set(rows.map(row=>row.group)).size,2);
  assert.deepEqual(watchedWallets({env:{FUNDED_OUTFLOW_WATCH_ADDRESSES:`Cold=${mint}`}}).map(row=>row.role),['Cold']);
});
