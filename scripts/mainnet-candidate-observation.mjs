import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';

const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const slot=value=>Number.isSafeInteger(value)&&value>0;
const amount=value=>Number.isSafeInteger(value)&&value>=0;

// Observation bootstraps the full account hash needed for later admission.
// It neither creates a reviewed release nor changes an activation setting.
export function validateCandidateSelection({candidate,plan,binary}){
  assert(candidate?.schemaVersion===1&&candidate.deployEligible===false);
  assert(/^[a-f0-9]{40}$/.test(candidate.sourceRevision)&&/^[a-f0-9]{40}$/.test(candidate.contractTree));
  assert(plan?.cluster==='mainnet-beta'&&plan.genesisHash===SOLANA_GENESIS['mainnet-beta']
    &&plan.mainnetActivationAuthorized===false&&plan.upgradeable===true);
  assert(new PublicKey(candidate.programId).toBase58()===plan.mainnetProgramId);
  assert(new PublicKey(plan.upgradeAuthority).toBase58()===plan.selectedPublicIdentities.adminUpgrade);
  assert(plan.selectedPublicIdentities.program===candidate.programId);
  assert(Buffer.isBuffer(binary)&&binary.length===candidate.binary?.bytes&&binary.length>=4
    &&binary.subarray(0,4).toString('hex')==='7f454c46'&&hash(binary)===candidate.binary.sha256,
  'Exact selected candidate ELF required.');
}

export async function observeCandidateOnConnection({connection,candidate,plan,binary}){
  validateCandidateSelection({candidate,plan,binary});
  const program=new PublicKey(candidate.programId),address=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const base={programId:String(program),programDataAddress:String(address)};
  try{
    const genesis=await connection.getGenesisHash();
    if(genesis!==SOLANA_GENESIS['mainnet-beta'])return {...base,status:'blocked',reason:'wrong-genesis'};
    const minimum=await connection.getSlot('finalized');assert(slot(minimum));
    // Both accounts from one finalized bank, avoiding a mixed upgrade snapshot.
    const read=await connection.getMultipleAccountsInfoAndContext([program,address],{commitment:'finalized',minContextSlot:minimum});
    assert(slot(read?.context?.slot)&&read.context.slot>=minimum&&read.value?.length===2);
    const [account,data]=read.value,contextSlot=read.context.slot;
    if(account===null&&data===null)return {...base,status:'not-deployed',genesisHash:genesis,contextSlot};
    const bytes=Buffer.from(data?.data||[]);
    const checks={
      programPointer:account?.executable===true&&account.owner.equals(loader)&&account.data.length===36
        &&account.data.readUInt32LE(0)===2&&new PublicKey(account.data.subarray(4)).equals(address),
      programDataHeader:data?.executable===false&&data.owner.equals(loader)&&bytes.length>=45
        &&bytes.readUInt32LE(0)===3&&bytes[12]===1,
      authority:bytes.length>=45&&bytes[12]===1&&new PublicKey(bytes.subarray(13,45)).toBase58()===plan.upgradeAuthority,
      candidateBytes:bytes.length>=45+binary.length&&bytes.subarray(45,45+binary.length).equals(binary),
      zeroPadding:bytes.length>=45+binary.length&&bytes.subarray(45+binary.length).every(value=>value===0),
      effectiveDeployment:bytes.length>=12&&bytes.readBigUInt64LE(4)<BigInt(contextSlot),
    };
    return {...base,status:Object.values(checks).every(Boolean)?'verified-candidate':'blocked',checks,genesisHash:genesis,
      contextSlot,programDataSha256:bytes.length?hash(bytes):null,
      deploymentSlot:bytes.length>=12?String(bytes.readBigUInt64LE(4)):null,
      allocatedProgramDataBytes:bytes.length,binarySha256:candidate.binary.sha256};
  }catch{return {...base,status:'unavailable',reason:'finalized-read-failed-or-malformed'};}
}

export async function observeMainnetCandidate({connections,candidate,plan,binary,now=()=>new Date()}){
  validateCandidateSelection({candidate,plan,binary});
  assert(Array.isArray(connections)&&connections.length===2&&connections[0]!==connections[1],'Two independently configured RPC readers required.');
  const observations=await Promise.all(connections.map(connection=>observeCandidateOnConnection({connection,candidate,plan,binary})));
  const [a,b]=observations;
  const verified=observations.every(row=>row.status==='verified-candidate')&&a.programDataSha256===b.programDataSha256;
  const absent=observations.every(row=>row.status==='not-deployed');
  return {schemaVersion:1,scope:'read-only-candidate-observation-not-release-admission',checkedAt:now().toISOString(),
    cluster:'mainnet-beta',status:verified?'verified-candidate':absent?'not-deployed':'blocked',
    candidate:{sourceRevision:candidate.sourceRevision,contractTree:candidate.contractTree,programId:candidate.programId,binary:candidate.binary},
    observations,mainnetActivationAuthorized:false,transactionsSigned:0,transactionsSubmitted:0};
}

export async function observeDeploymentFunding({connection,candidate,plan}){
  try{
    assert(await connection.getGenesisHash()===SOLANA_GENESIS['mainnet-beta']);
    const payer=new PublicKey(plan.selectedPublicIdentities.deploymentPayer);
    const read=await connection.getBalanceAndContext(payer,{commitment:'finalized'});
    assert(slot(read.context?.slot)&&amount(read.value));
    const [program,data,buffer]=await Promise.all([36,45+candidate.binary.bytes,37+candidate.binary.bytes]
      .map(bytes=>connection.getMinimumBalanceForRentExemption(bytes,'finalized')));
    assert([program,data,buffer].every(amount));
    const locked=BigInt(program)+BigInt(data);
    return {status:'observed',payer:String(payer),contextSlot:read.context.slot,balanceLamports:String(read.value),
      programRentLamports:String(program),programDataRentLamports:String(data),bufferRentLamports:String(buffer),
      lockedRentLamports:String(locked),rentOnlyShortfallLamports:String(locked>BigInt(read.value)?locked-BigInt(read.value):0n),
      scope:'Rent and public balance only; excludes transaction fees, initialization, operating reserve and financial acceptance. No funding authorization.'};
  }catch{return {status:'unavailable',reason:'public-funding-read-failed-or-malformed'};}
}
