import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';import {unpackMint,unpackAccount,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {communityArchiveFixture} from './community-archive-fixture.mjs';
for(const mode of ['control','classic-mint-trailing-byte','classic-token-trailing-byte'])test('archive restart '+mode+' requires supported raw account layout',async t=>{
 const f=await communityArchiveFixture(t),r=await f.service().prepare(f.input);
 const p=JSON.parse(await readFile(join(f.directory,r.snapshotEvidence.sha256+'.json'),'utf8'));
 const isMint=mode!=='classic-token-trailing-byte',row=isMint?p.evidence.bankEvidence.mint:p.evidence.bankEvidence.accounts[0];
 if(mode!=='control')row.account.dataBase64=Buffer.concat([Buffer.from(row.account.dataBase64,'base64'),Buffer.from([99])]).toString('base64');
 let sdkAccepted=false,sdkError;try{(isMint?unpackMint:unpackAccount)(new PublicKey(row.address),{...row.account,owner:new PublicKey(row.account.owner),data:Buffer.from(row.account.dataBase64,'base64')},TOKEN_PROGRAM_ID);sdkAccepted=true;}catch(e){sdkError=e.constructor.name;}
 assert.equal(sdkAccepted,mode==='control');
 const bytes=Buffer.from(JSON.stringify(p)),sha=createHash('sha256').update(bytes).digest('hex');await writeFile(join(f.directory,sha+'.json'),bytes);
 await f.store.transaction(s=>Object.assign(s.communityDrops[String(f.launch)].snapshotEvidence,{sha256:sha,bytes:bytes.length}));
 for(const name of Object.keys(f.connection))if(typeof f.connection[name]==='function')f.connection[name]=async()=>{throw Error('No RPC/current balances');};
 let accepted=false,error;try{await f.reopen().prepared(f.launch);accepted=true;}catch(e){error=e.message;}
 console.log(JSON.stringify({mode,sdkAccepted,sdkError,validContentHash:true,offlineRestartAccepted:accepted,error}));
 assert.equal(accepted,mode==='control','Malformed raw bank must not qualify even with a valid content hash');
});