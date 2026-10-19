// Read-only preparation. This script never loads a signing key, submits a
// transaction, updates the reward ledger, or changes the approved program pin.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Connection, PublicKey } from '@solana/web3.js';
import { buildMintRouterV3SettlementInstruction, protocolGrossUnits,
  verifyMintPolicyV3Account } from '../mint-router-v3.js';
import { QA_SETTLEMENT_RECOVERY as approved,
  buildQaSettlementRecoveryInstruction } from '../server/devnet-qa-settlement-recovery.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { readProgramDataEvidence } from '../server/program-data-evidence.mjs';
import { loadFinalizedV3PumpCollection } from '../server/v3-finalized-collection.mjs';
import { creatorSettlementRetryState } from '../server/creator-settlement-transaction.mjs';

const { values } = parseArgs({options:{records:{type:'string'},artifact:{type:'string'},
  report:{type:'string'},'artifact-sha256':{type:'string'},'current-program-sha256':{type:'string'},
  'rpc-file':{type:'string',default:'.secrets/solana-devnet-rpc-url'}}});
const first = Object.freeze({mint:'33NWqBP7VedxoKm5M7qZbb8LT6xvBu8iHQrwD5wkbkKH',
  creator:'8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk',
  collectionSignature:'1czZxRueqMh6XWPoLS37tA4JgaxFGeaNU5JPszEMRuygzy67AwaN4QTWmAhKASyojG3D45RwYZPtHNqNJKt9orA',
  claimId:'5ca381169749d2c31183eaaaa51639ccafb63c2ebb93f21d6721a001e07aeb8b',expectedLamports:'204105'});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const targets = (total,split) => {
  let prefix=0n,previous=0n;
  return [8_000_000,...protocolGrossUnits(split)].map(rate=>{
    prefix+=BigInt(rate);const end=total*prefix/10_000_000n,delta=end-previous;previous=end;return delta;
  });
};

async function main() {
  for (const field of ['records','artifact','report','artifact-sha256','current-program-sha256'])
    assert(values[field],`Missing --${field}`);
  assert.match(values['artifact-sha256'],/^[a-f0-9]{64}$/);
  assert.match(values['current-program-sha256'],/^[a-f0-9]{64}$/);
  const artifact=await readFile(values.artifact);
  assert.equal(hash(artifact),values['artifact-sha256']);
  const records=JSON.parse(await readFile(values.records,'utf8'));
  const state={};
  for (const row of records.rows) (state[row.bucket] ||= {})[row.entity_key]=row.payload;
  const rpc=(await readFile(values['rpc-file'],'utf8')).trim();
  const connection=new Connection(rpc,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(12_000)})});
  console.log('Checking Devnet and the current approved program.');
  assert.equal(await connection.getGenesisHash(),DEVNET_GENESIS_HASH);
  const evidence=await readProgramDataEvidence(connection,new PublicKey(approved.programId),{rpcUrl:''});
  assert.equal(evidence.sha256,values['current-program-sha256']);
  assert.equal(evidence.programData.data[12],1);
  assert.equal(new PublicKey(evidence.programData.data.subarray(13,45)).toBase58(),approved.authority);
  const capacity=evidence.programData.data.length-45;
  assert(artifact.length<=capacity);
  const padded=Buffer.alloc(capacity);artifact.copy(padded);
  const settlements=[];
  for (const [index,record] of [first,approved].entries()) {
    console.log(`Checking historical collection ${index+1} of 2.`);
    const launch=state.launches[record.mint],collection=state.collections[record.collectionSignature];
    assert.equal(launch.creatorWallet,record.creator);
    assert.equal(collection.collectedLamports,Number(record.expectedLamports));
    assert.equal(collection.claimId,record.claimId);
    const split=launch.pumpFeeRoute.protocolSplit;
    const source=await loadFinalizedV3PumpCollection({connection,signature:record.collectionSignature,
      programId:approved.programId,mint:record.mint,launch});
    assert(source); assert.equal(source.expectedLamports,BigInt(record.expectedLamports));
    assert.equal(source.claimId.toString('hex'),record.claimId);
    const input={programId:approved.programId,authority:approved.authority,mint:record.mint,
      creator:record.creator,claimId:source.claimId,expectedLamports:source.expectedLamports,split};
    const built=index===0?buildMintRouterV3SettlementInstruction(input):buildQaSettlementRecoveryInstruction(input);
    const policy=await verifyMintPolicyV3Account({connection,programId:approved.programId,mint:record.mint,
      creator:record.creator,initialAuthority:approved.authority,split});
    assert(policy.verified);
    if (index===1) {
      assert.equal(policy.protectedPolicy,false);
      assert.equal(String(policy.settledLamports),approved.priorSettledLamports);
      assert.deepEqual(policy.protocolUnits,[...approved.protocolUnits]);
    }
    assert.deepEqual(policy.paidLamports,targets(policy.settledLamports,split));
    assert.equal(await connection.getAccountInfo(built.claim,'finalized'),null);
    const router=await connection.getAccountInfo(built.router.address,'finalized');
    const rent=await connection.getMinimumBalanceForRentExemption(router.data.length);
    const available=BigInt(router.lamports-rent); assert(available>=source.expectedLamports);
    const prior=state.v3Settlements?.[record.collectionSignature];
    if (prior?.settlementSignature) {
      const retry=await creatorSettlementRetryState({connection,
        signatures:[prior.settlementSignature],blockhash:prior.blockhash});
      assert(retry.retry,'A prior signature still requires reconciliation.');
    }
    const high=targets(policy.settledLamports+source.expectedLamports,split);
    settlements.push({mint:record.mint,creator:record.creator,collectionSignature:record.collectionSignature,
      claimId:record.claimId,amountLamports:record.expectedLamports,
      authorization:index===0?'authority-and-original-creator':'restricted-devnet-qa-recovery',
      router:built.router.address.toBase58(),claim:built.claim.toBase58(),
      routerBeforeLamports:router.lamports,routerRentLamports:rent,
      expectedUnallocatedSurplusLamports:String(available-source.expectedLamports),
      priorSettledLamports:String(policy.settledLamports),
      priorWithdrawnLamports:policy.withdrawnLamports.map(String),
      categoryLamports:high.map((amount,i)=>String(amount-policy.paidLamports[i])),
      unsignedInstruction:{programId:approved.programId,dataBase64:built.instruction.data.toString('base64'),
        accounts:built.instruction.keys.map(entry=>({...entry,pubkey:entry.pubkey.toBase58()}))}});
  }
  const bufferRent=await connection.getMinimumBalanceForRentExemption(artifact.length+37);
  const authorityBalance=await connection.getBalance(new PublicKey(approved.authority),'finalized');
  const feeBudget=30_000_000,reserve=3_000_000_000;
  const report={checkedAt:new Date().toISOString(),mode:'read-only-preparation',cluster:'devnet',
    currentProgramId:approved.programId,currentProgramDataSha256:evidence.sha256,
    candidateArtifactBytes:artifact.length,candidateArtifactSha256:hash(artifact),
    candidateExecutableCapacity:capacity,candidatePaddedExecutableSha256:hash(padded),
    runtimePinRule:'After upgrade, compare exact executable bytes and zero padding, then pin the full ProgramData hash including its new slot metadata.',
    authority:approved.authority,authorityBalanceLamports:authorityBalance,
    freshBufferRentLamports:bufferRent,estimatedFeeBudgetLamports:feeBudget,reserveFloorLamports:reserve,
    requiredPayerBalanceLamports:bufferRent+feeBudget+reserve,
    additionalFundingLamports:Math.max(0,bufferRent+feeBudget+reserve-authorityBalance),
    totalSettlementLamports:'946680',settlements,submitted:false,ledgerUpdated:false};
  await writeFile(values.report,JSON.stringify(report,null,2));
  console.log(JSON.stringify({prepared:true,submitted:false,artifactSha256:report.candidateArtifactSha256,
    additionalFundingLamports:report.additionalFundingLamports,report:values.report}));
}
main().catch(error=>{
  if (error?.code==='ERR_ASSERTION') console.error(error.message);
  console.error('Historical settlement preflight failed. No signing, submission or ledger changes were performed.');
  process.exitCode=1;
});
