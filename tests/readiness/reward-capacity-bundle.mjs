import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,open,mkdir,realpath} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {PublicKey,Transaction} from '@solana/web3.js';
import {historicalPayoutFixture,PAYOUT_ASSETS} from './reward-payout-fixture.mjs';
import {installCapacityBank} from './reward-capacity-mixed-fixture.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const encode=a=>({...a,owner:String(a.owner),dataBase64:a.data.toString('base64'),data:undefined});
const decode=a=>({...a,owner:new PublicKey(a.owner),data:Buffer.from(a.dataBase64,'base64'),dataBase64:undefined});
const json=d=>Buffer.from(JSON.stringify(d));
async function exclusiveFile(path,bytes){const f=await open(path,'wx');try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}

// Export only PUBLIC synthetic bank/transactions and the closed ledger. Never
// serialize fixture keys/signers, private bytes, an endpoint or credentials.
export async function writeCapacityBundle(directory,ledgerBytes,cohorts){
  await mkdir(directory,{recursive:true});const bank=json(cohorts.map(c=>({assetName:c.profile.asset,profile:c.profile,mixedProfile:c.mixedProfile,
    slot:c.f.slot,programId:String(c.f.program),programDataSha256:c.options.expectedProgramDataSha256,
    vault:String(c.f.vault),cycle:String(c.f.cycle),reserve:String(c.f.reserve),
    rows:[...c.f.rows].map(([k,a])=>[k,encode(a)]),balances:[...c.f.balances],tokens:[...c.f.tokens].map(([k,n])=>[k,String(n)]),
    transactions:[...c.f.capacityTransactions].map(([signature,tx])=>({signature,slot:tx.slot,blockTime:tx.blockTime,meta:tx.meta}))})));
  const index=json({version:1,scope:'public-synthetic-capacity-snapshot-not-chain-proof',
    files:{'ledger.json':digest(ledgerBytes),'bank.json':digest(bank)}});
  await exclusiveFile(join(directory,'ledger.json'),ledgerBytes);await exclusiveFile(join(directory,'bank.json'),bank);
  // Index published last; an incomplete multi-file copy cannot be reopened.
  await exclusiveFile(join(directory,'index.json'),index);return digest(index);
}

export async function readCapacityBundle(directory,expectedIndexSha){
  assert(/^[a-f0-9]{64}$/.test(expectedIndexSha||''),'Externally retained public bundle digest required.');
  const root=await realpath(directory),read=async name=>{
    const path=join(root,name);assert((await realpath(path)).startsWith(root+sep),'Capacity bundle file escaped its root.');return readFile(path);
  };
  const indexBytes=await read('index.json');assert.equal(digest(indexBytes),expectedIndexSha,'Capacity index checksum differs.');
  const index=JSON.parse(indexBytes);assert.equal(index.version,1);assert.deepEqual(Object.keys(index.files).sort(),['bank.json','ledger.json']);
  const bytes=await read('ledger.json'),bank=await read('bank.json');assert.equal(digest(bytes),index.files['ledger.json']);assert.equal(digest(bank),index.files['bank.json']);
  const state=JSON.parse(bytes),saved=JSON.parse(bank);assert.equal(state.version,2);assert(saved.length>=1&&saved.length<=3);
  const cohorts=saved.map(b=>{
    const asset=PAYOUT_ASSETS.find(a=>a.name===b.assetName);assert(asset);const f=historicalPayoutFixture(asset),plan=state.schedules['capacity-'+b.assetName];
    assert(plan?.manifest?.leaves.length===b.profile.count&&b.profile.count<=1001&&plan.manifest.root===b.profile.root);
    assert.equal(String(f.program),b.programId);assert.equal(f.release.programDataSha256,b.programDataSha256);assert.equal(f.slot,b.slot);
    f.plan=plan;f.vault=new PublicKey(b.vault);f.cycle=new PublicKey(b.cycle);f.reserve=new PublicKey(b.reserve);
    f.rows=new Map(b.rows.map(([k,a])=>[k,decode(a)]));f.balances=new Map(b.balances);f.tokens=new Map(b.tokens.map(([k,n])=>[k,BigInt(n)]));
    f.sends=0;f.latestCalls=0;
    f.connection.sendRawTransaction=async()=>{f.sends++;throw Error('Restored workload must not broadcast');};
    f.connection.getLatestBlockhash=async()=>{f.latestCalls++;throw Error('Restored workload must not create a new attempt');};
    const c={plan,f,profile:b.profile,mixedProfile:b.mixedProfile,options:{programId:f.program,currentAuthority:f.operator,cluster:'devnet',expectedProgramDataSha256:b.programDataSha256}};
    installCapacityBank(c);
    const bySignature=new Map(Object.values(plan.payoutAttempts).map(a=>[a.signature,a]));
    for(const tx of b.transactions){
      const attempt=bySignature.get(tx.signature);assert(attempt);const signed=Transaction.from(Buffer.from(attempt.transactionBase64,'base64'));
      assert(signed.verifySignatures());f.capacityTransactions.set(tx.signature,{slot:tx.slot,blockTime:tx.blockTime,meta:tx.meta,
        transaction:{signatures:[tx.signature],message:signed.compileMessage()}});
    }
    c.chain=f.chain();return c;
  });return {ledgerBytes:bytes,state,cohorts,indexSha:expectedIndexSha};
}
