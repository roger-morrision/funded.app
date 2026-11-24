import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createFileTokenConversionCustody} from '../server/token-conversion-file-custody.mjs';

// Offline deployment inspection. It loads and validates one role, then wipes
// its in-process key. No RPC, signature, transaction or HTTP listener exists.
let resolver;
try{
  assert(process.argv.length===3,'One explicit public custody configuration required.');
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  assert(Object.keys(config).length===5&&['role','reference','publicKey','programId','keyFile'].every(k=>typeof config[k]==='string'));
  resolver=createFileTokenConversionCustody(config);
  const handle=await resolver(config.reference,{role:config.role,publicKey:config.publicKey});
  assert.equal(handle.publicKey,config.publicKey);
  console.log(JSON.stringify({role:config.role,publicKey:handle.publicKey,keyValidated:true,signaturesCreated:0,networkCalls:0,releaseAdmitted:false}));
}catch{console.error('Custody inspection failed; no signing or activation occurred.');process.exitCode=1;}
finally{await resolver?.close();}
