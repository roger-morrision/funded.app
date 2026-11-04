import test from 'node:test';import assert from 'node:assert/strict';
import {validatePreferenceTransfer} from '../experience-preferences.js';
import {saveNotifications,normalizeNotifications} from '../src/features/experience/notification-preferences.js';
const wallet='So11111111111111111111111111111111111111112',base={version:1,wallets:[],creators:[],reminders:[]};
test('preference imports reject public keys with the wrong decoded length and invalid rows',()=>{
 for(const value of ['1'.repeat(33),'z'.repeat(44),null])assert.throws(()=>validatePreferenceTransfer({...base,wallets:[value===null?null:{address:value,roles:['creator']}]}),/valid public followed wallets/);
});
test('token reminder routes require a valid 32-byte public key',()=>{
 assert.throws(()=>validatePreferenceTransfer({...base,reminders:[{id:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12),at:Date.now()+60000,label:'Invalid mint',href:'/token/'+'1'.repeat(33)}]}),/reminders/);
});
test('duplicate public wallets within a single import preserve both follow roles',()=>{
 const result=validatePreferenceTransfer({...base,wallets:[{address:wallet,roles:['creator']},{address:wallet,roles:['trader']}]});assert.deepEqual(result.wallets,[{address:wallet,roles:['creator','trader']}]);
});
for(const mode of ['silent-primary','legacy-failure','readback-failure'])test(`notification ${mode} cannot report a successful or partial save`,()=>{
 const key='funded.notification-preferences.v1',legacy='funded.creator-activity-alerts.v1',prior=normalizeNotifications({enabled:false,minimumSol:'0.1'}),values=new Map([[key,JSON.stringify(prior)],[legacy,'false']]);let written=false;
 const storage={getItem(name){if(mode==='readback-failure'&&written&&name===key)throw Error('Read denied');return values.get(name)??null},setItem(name,value){if(name===key){if(mode==='silent-primary')return;written=true}if(mode==='legacy-failure'&&name===legacy&&value==='true')throw Error('Quota');values.set(name,value)},removeItem:name=>values.delete(name)};
 assert.throws(()=>saveNotifications({...prior,enabled:true,minimumSol:'0.2'},storage));assert.equal(values.get(key),JSON.stringify(prior));assert.equal(values.get(legacy),'false');
});
import {createServer} from 'node:http';import {createCreatorSupportHandler} from '../server/creator-support.mjs';
test('actual account-sync HTTP rejects malformed keys without replacing saved preferences (labeled identity)',async()=>{
 let state={creatorProfiles:{}},commits=0;
 const handler=createCreatorSupportHandler({cluster:'devnet',getSession:async()=>({user:{id:'123',username:'labeled_test_identity'},creatorCsrf:'fixture-csrf'}),store:{chargeRpcRate:async()=>true,updateCreatorProfile:async(id,fn)=>{const next=structuredClone(state),result=fn(next);state=next;commits++;return result}}});
 const server=createServer(async(req,res)=>{try{if(!await handler(req,res,new URL(req.url,`http://${req.headers.host}`))){res.writeHead(404);res.end()}}catch{res.writeHead(500);res.end()}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const post=body=>fetch(origin+'/api/creator-support/device-preferences',{method:'POST',headers:{origin,'content-type':'application/json','x-creator-csrf':'fixture-csrf'},body:JSON.stringify(body)});
 try{const response=await post({...base,wallets:[{address:wallet,roles:['creator']},{address:wallet,roles:['trader']}]});assert.equal(response.status,200);assert.equal((await response.json()).saved,true);assert.deepEqual(state.creatorProfiles['123'].workspacePreferences.wallets[0].roles,['creator','trader']);const prior=JSON.stringify(state);const invalid=await post({...base,wallets:[{address:'1'.repeat(33),roles:[]}]});assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/valid public followed wallets/);assert.equal(JSON.stringify(state),prior);assert.equal(commits,1);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
