import test from 'node:test';
import assert from 'node:assert/strict';
import {createPendingWithdrawals} from '../admin-withdrawal-pending.js';
import {initAdminWithdrawals} from '../admin-withdrawals.js';

const KEY='funded.admin.pending-withdrawals.v2',LEGACY='funded.admin.pending-withdrawal.devnet.v1';
const row=(destination='admin-A',source='source-A',signature='2'.repeat(88))=>({destination,source,signature,intentId:'intent',lastValidBlockHeight:100});
function storage(){const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
function element(){return {value:'',hidden:false,disabled:false,dataset:{},options:[],textContent:'',children:[],handlers:{},
  classList:{toggle(name,value){this[name]=value;}},addEventListener(name,fn){this.handlers[name]=fn;},append(child){this.children.push(child);},
  querySelectorAll(){return[];},reportValidity(){return true;}};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function ui({saved,api=async()=>({pending:null}),post=async()=>{throw Error('Email confirmation cancelled.');},rpc}={}){
  const backing=storage();if(saved)backing.setItem(LEGACY,JSON.stringify(saved));
  globalThis.sessionStorage=backing;globalThis.MutationObserver=class{observe(){}};
  const ids=['workspace','withdraw-form','reconcile-form','withdraw-review','withdraw-status','reconcile-signature','withdraw-max','withdraw-destination','withdraw-source','withdraw-amount'];
  const nodes=Object.fromEntries(ids.map(id=>[id,element()])),submit=element(),receipt=element();
  nodes['withdraw-form'].querySelector=()=>submit;nodes['reconcile-form'].querySelector=()=>receipt;
  nodes.workspace.dataset.sessionEpoch='1';nodes['withdraw-destination'].value='admin-A';
  nodes['withdraw-source'].value='source-A';nodes['withdraw-source'].options=[{}];
  nodes['withdraw-amount'].value='0.1';let currentAdmin='admin-A';const messages=[];
  const provider={isPhantom:true,signTransaction(){throw Error('Unexpected signing');},publicKey:{toBase58:()=>currentAdmin}};
  const controller=initAdminWithdrawals({document:{querySelector:s=>nodes[s.slice(1)],createElement:element},api,post,show:(...args)=>messages.push(args),refresh:async()=>{},wallet:()=>provider,connected:()=>currentAdmin,...(rpc?{connectionFactory:()=>rpc}:{})});
  return {nodes,submit,backing,messages,controller,switchAdmin(value){currentAdmin=value;nodes['withdraw-destination'].value=value;nodes.workspace.dataset.sessionEpoch=String(Number(nodes.workspace.dataset.sessionEpoch)+1);controller.sync();}};
}
test('legacy recovery migrates and pending identities remain isolated by network, admin and source',()=>{
  const s=storage();s.setItem(LEGACY,JSON.stringify(row()));const journal=createPendingWithdrawals(s);
  assert.equal(s.getItem(LEGACY),null);assert(journal.get('admin-A','source-A'));
  assert.equal(journal.get('admin-B','source-A'),null);assert.equal(journal.get('admin-A','source-B'),null);
  assert.equal(createPendingWithdrawals(s,'mainnet-beta').get('admin-A','source-A'),null);
  journal.save({...row('admin-B','source-B','3'.repeat(88)),signedTransaction:'must-not-persist'});
  assert(!s.getItem(KEY).includes('must-not-persist'));
  journal.clear(row());assert.equal(journal.get('admin-A','source-A'),null);
  assert(createPendingWithdrawals(s).get('admin-B','source-B'));
});
test('switching admins or sources preserves unresolved receipts without disabling unrelated withdrawals',async()=>{
  const f=ui({saved:row()});assert.equal(f.submit.disabled,false);assert.equal(f.nodes['withdraw-max'].disabled,false);
  f.switchAdmin('admin-B');assert.equal(f.submit.disabled,false);assert.equal(f.nodes['withdraw-max'].disabled,false);
  assert.equal(f.nodes['reconcile-signature'].value,'');assert(f.nodes['reconcile-form'].children[0].hidden);
  f.switchAdmin('admin-A');assert.equal(f.nodes['reconcile-signature'].value,row().signature);
  f.nodes['withdraw-source'].value='source-B';f.nodes['withdraw-source'].handlers.change();assert.equal(f.submit.disabled,false);
  f.nodes['withdraw-source'].value='source-A';f.nodes['withdraw-source'].handlers.change();assert.equal(f.nodes['reconcile-signature'].value,row().signature);
  assert(createPendingWithdrawals(f.backing).get('admin-A','source-A'));await flush();
});
test('late recovery responses cannot replace the selected admin/source',async()=>{
  let release;const f=ui({api:()=>new Promise(resolve=>{release=resolve;})});const old=release;
  f.switchAdmin('admin-B');old({pending:row()});await flush();
  assert.equal(f.submit.disabled,false);assert.equal(f.nodes['reconcile-signature'].value,'');
});
test('Max failures and email cancellation remain visible beside the withdrawal form',async()=>{
  const f=ui({api:async path=>{if(path.includes('/maximum'))throw Error('RPC balance unavailable.');return{pending:null};}});
  f.nodes['withdraw-max'].handlers.click();await flush();
  assert.equal(f.nodes['withdraw-status'].textContent,'RPC balance unavailable.');assert(f.nodes['withdraw-status'].classList.error);
  f.nodes['withdraw-form'].handlers.submit({preventDefault(){}});await flush();
  assert.equal(f.nodes['withdraw-status'].textContent,'Email confirmation cancelled.');assert(f.nodes['withdraw-status'].classList.error);
  assert.equal(f.submit.disabled,false);
});
test('invalid manual receipt is an inline error, not a transaction submission',()=>{
  const f=ui();f.nodes['reconcile-signature'].value='invalid';f.nodes['reconcile-form'].handlers.submit({preventDefault(){}});
  assert.match(f.nodes['withdraw-status'].textContent,/valid Devnet transaction signature/);assert(f.nodes['withdraw-status'].classList.error);
});
test('failed or expired transfer permits a newly entered amount; unknown outcome never signs a replacement',async()=>{
  for(const outcome of ['failed','expired','unknown']){
    const sig=row().signature,err={InstructionError:[0,'Custom']};let prepared;
    const rpc={getGenesisHash:async()=>'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      getSignatureStatuses:async()=>({value:[outcome==='failed'?{confirmationStatus:'finalized',err}:outcome==='unknown'?{confirmationStatus:'processed',err:null}:null]}),
      getBlockHeight:async()=>200,getTransaction:async()=>outcome==='failed'?{meta:{err},transaction:{signatures:[sig]}}:null};
    const f=ui({saved:row(),rpc,post:async(_path,input)=>{prepared=input;throw Error('New email code required.');}});
    f.nodes['withdraw-amount'].value='0.25';f.nodes['withdraw-form'].handlers.submit({preventDefault(){}});await flush();
    assert.equal(f.submit.disabled,false);assert.equal(f.nodes['withdraw-max'].disabled,false);
    if(outcome==='unknown'){
      assert.equal(prepared,undefined);assert(createPendingWithdrawals(f.backing).get('admin-A','source-A'));
      assert.match(f.nodes['withdraw-status'].textContent,/outcome is still pending/);
    }else{
      assert.equal(prepared.amountLamports,250000000);assert.equal(createPendingWithdrawals(f.backing).get('admin-A','source-A'),null);
      assert.equal(f.nodes['withdraw-status'].textContent,'New email code required.');
    }
  }
});
