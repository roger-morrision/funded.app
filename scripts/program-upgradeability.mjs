import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {assertRpcNetwork} from '../solana-network.js';
import {readProgramDataEvidence} from '../server/program-data-evidence.mjs';

const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

// Public, read-only evidence. Never infer upgradeability from executable=true
// or from a CLI exit code: a finalized program can have no remaining authority.
export function inspectUpgradeability(evidence,{programId,authority,hash}={}) {
  const checks={executableUpgradeableProgram:false,canonicalProgramData:false,
    validProgramDataHeader:false,retainedUpgradeAuthority:false,approvedUpgradeAuthority:false,approvedProgramBytes:false};
  let upgradeAuthority=null;
  try {
    const key=new PublicKey(programId),address=PublicKey.findProgramAddressSync([key.toBuffer()],loader)[0];
    const program=evidence.account,data=evidence.programData,bytes=Buffer.from(data?.data||[]);
    checks.executableUpgradeableProgram=program?.executable===true&&program.owner.equals(loader);
    checks.canonicalProgramData=Boolean(program?.data?.length===36&&program.data.readUInt32LE(0)===2
      &&new PublicKey(program.data.subarray(4,36)).equals(address)&&evidence.programDataAddress===address.toBase58());
    checks.validProgramDataHeader=Boolean(data?.executable===false&&data.owner.equals(loader)
      &&bytes.length>=45&&bytes.readUInt32LE(0)===3&&[0,1].includes(bytes[12]));
    if(checks.validProgramDataHeader&&bytes[12]===1)upgradeAuthority=new PublicKey(bytes.subarray(13,45)).toBase58();
    checks.retainedUpgradeAuthority=upgradeAuthority!==null;
    checks.approvedUpgradeAuthority=Boolean(authority&&upgradeAuthority===new PublicKey(authority).toBase58());
    checks.approvedProgramBytes=Boolean(/^[a-f0-9]{64}$/.test(hash||'')&&evidence.sha256===hash
      &&createHash('sha256').update(bytes).digest('hex')===hash);
  } catch { /* Malformed or incomplete evidence fails closed. */ }
  return {programId,status:Object.values(checks).every(Boolean)?'verified':'blocked',checks,
    programDataAddress:evidence?.programDataAddress||null,observedProgramDataSha256:evidence?.sha256||null,upgradeAuthority};
}

export async function auditProgramUpgradeability(connection,roles,{cluster}={}) {
  await assertRpcNetwork(connection,cluster);
  if(!Array.isArray(roles)||!roles.length)throw Error('An explicit app-program inventory is required.');
  const cache=new Map(),programs=[];
  for(const row of roles) {
    if(!cache.has(row.programId))cache.set(row.programId,await readProgramDataEvidence(connection,row.programId,{cluster,rpcUrl:''}));
    programs.push({...inspectUpgradeability(cache.get(row.programId),row),role:row.role});
  }
  return {cluster,status:programs.every(row=>row.status==='verified')?'verified':'blocked',programs};
}
