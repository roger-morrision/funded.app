import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import bs58 from 'bs58';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {DEVNET_GENESIS_HASH,readProgramDataEvidence,rewardAddresses,rewardReserveAddress} from './automatic-reward-chain.mjs';
import {verifyRewardProof} from '../reward-merkle.js';
import {deriveCommunityRewardVaultV3} from '../mint-router-v3.js';
import {verifyAutomaticPayment} from './payment-history.mjs';
import {dailyPaymentCandidates,loadDailyPayment} from './daily-bonus-payment-history.mjs';
import {loadFinalizedV3PumpCollection} from './v3-finalized-collection.mjs';
import {loadFinalizedV3Settlement} from './v3-settlement-proof.mjs';
import {v3AllocationPlan} from './v3-allocation-plan.mjs';
import {v3ReferralEntitlement} from './v3-referral-entitlement.mjs';
import {v3DisbursementId} from './v3-disbursement-id.mjs';
import {loadFinalizedV3RewardFunding} from './v3-reward-funding-proof.mjs';
import {v3SourceAllocation,v3ResidualAllocation,residualDisbursementId} from './v3-residual-source.mjs';

const discriminator=name=>createHash('sha256').update(name).digest().subarray(0,8);
const finalized=row=>row?.finalized===true&&row.balanceDeltaVerified===true;
const launchV3=row=>row?.cluster==='devnet'&&row.onchainVerified===true&&row.pumpFeeRoute?.scope==='per-mint-v3'&&row.pumpFeeRoute.verified===true;

// Funding transfers and buybacks are not recipient payouts. Keep their ledgers
// out of this list. Stable receipt PDAs also deduplicate recovered signatures.
export function automaticPayoutCandidates(state,rewardState={}) {
  const rows=[];
  for(const [scheduleId,schedule]of Object.entries(rewardState?.schedules||{})) {
    if(!['holder','x'].includes(schedule.kind)||schedule.asset!=='SOL'||!launchV3(state.launches?.[schedule.mint]))continue;
    for(const [recipient,payment]of Object.entries(schedule.payments||{}))if(payment.status==='paid'&&finalized(payment))
      rows.push({mint:schedule.mint,signature:payment.signature,receiptId:payment.payment,recipient,paidAt:payment.paidAt||schedule.paidAt,kind:schedule.kind,scheduleId});
  }
  for(const [snapshotId,saved]of Object.entries(rewardState?.dailyBonusSnapshots||{}))
    for(const [source,payout]of Object.entries(saved.payouts||{}))
      for(const [recipient,payment]of Object.entries(payout.payments||{}))if(finalized(payment)) {
        const mint=saved.snapshot?.sources?.find(row=>row.collectionSignature===source)?.mint;
        if(launchV3(state.launches?.[mint]))rows.push({mint,signature:payment.signature,receiptId:payment.payment,recipient,paidAt:payment.paidAt||saved.paidAt,kind:'bonus',snapshotId,source});
      }
  for(const [bucket,kind]of [['v3CreatorWalletPayout','creator'],['v3ReferralPayouts','referral'],['v3OperationsPayout','operations']])
    for(const [recordId,row]of Object.entries(state[bucket]||{}))if(row.status==='finalized'&&row.balanceDeltaVerified===true&&launchV3(state.launches?.[row.mint]))
      rows.push({mint:row.mint,signature:row.signature,receiptId:row.withdrawal,recipient:row.recipient,paidAt:row.finalizedAt,kind,bucket,recordId,
        source:kind==='creator'&&row.residualPlanHash?recordId:row.collectionSignature,level:row.level});
  return rows;
}

export async function loadAutomaticPayoutProof({connection,programId,authority,schedule,recipient}) {
  const payment=schedule.payments?.[recipient],leaf=schedule.manifest?.leaves.find(row=>row.recipient===recipient);
  if(payment&&!payment.signature&&payment.payment) {
    const history=await connection.getSignaturesForAddress(new PublicKey(payment.payment),{limit:20},'finalized');
    for(const row of history.filter(row=>!row.err&&row.confirmationStatus==='finalized')) {
      try{return await loadAutomaticPayoutProof({connection,programId,authority,recipient,schedule:{...schedule,payments:{...schedule.payments,[recipient]:{...payment,signature:row.signature}}}});}catch{}
    }
    throw new Error('Recovered payout has no matching finalized creation transaction.');
  }
  assert(leaf&&payment?.amount===leaf.amount&&verifyRewardProof({cycleId:schedule.manifest.cycleId,asset:'SOL',recipient,amount:leaf.amount,index:leaf.index,proof:leaf.proof,root:schedule.manifest.root}));
  const addresses=rewardAddresses({programId,authority,mint:schedule.mint,cycleId:schedule.manifest.cycleId,recipient});
  assert.equal(payment.payment,addresses.payment.toBase58());assert.equal(schedule.cycle,addresses.cycle.toBase58());
  const [tx,account,cycle]=await Promise.all([connection.getTransaction(payment.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}),connection.getAccountInfo(addresses.payment,'finalized'),connection.getAccountInfo(addresses.cycle,'finalized')]);
  assert(tx&&tx.meta?.err===null&&tx.transaction.signatures.includes(payment.signature));
  const proof=verifyAutomaticPayment(schedule,recipient,payment,tx);assert(proof);
  assert.equal(account?.owner.toBase58(),programId);assert.equal(account.data.length,100);assert(account.data.subarray(0,8).equals(discriminator('account:RewardPayment')));
  assert(account.data.subarray(8,40).equals(addresses.cycle.toBuffer()));assert(account.data.subarray(40,72).equals(new PublicKey(recipient).toBuffer()));
  assert.equal(String(account.data.readBigUInt64LE(72)),leaf.amount);assert.equal(account.data.readUInt32LE(80),leaf.index);assert(account.data.readBigInt64LE(84)>=BigInt(schedule.payoutAt));
  assert.equal(cycle?.owner.toBase58(),programId);assert.equal(cycle.data.length,174);assert(cycle.data.subarray(0,8).equals(discriminator('account:RewardCycle')));
  assert(cycle.data.subarray(8,40).equals(addresses.vault.toBuffer()));assert.equal(cycle.data.subarray(40,72).toString('hex'),schedule.manifest.cycleId);
  assert.equal(cycle.data.subarray(72,104).toString('hex'),schedule.manifest.root);assert.equal(String(cycle.data.readBigUInt64LE(136)),schedule.manifest.totalAmount);
  assert(cycle.data.subarray(104,136).equals(Buffer.alloc(32)));assert(cycle.data.readBigUInt64LE(144)<=BigInt(schedule.manifest.totalAmount));
  assert(cycle.data.readBigUInt64LE(144)>=BigInt(leaf.amount));assert.equal(cycle.data.readBigInt64LE(152),BigInt(schedule.cutoffAt));assert.equal(cycle.data.readBigInt64LE(160),BigInt(schedule.payoutAt));assert.equal(cycle.data.readUInt32LE(168),schedule.manifest.leaves.length);assert.equal(cycle.data[173],1);
  const message=tx.transaction.message,keys=[...(message.accountKeys||message.staticAccountKeys||[]),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(key=>key.toBase58());
  const expected=[authority,addresses.vault.toBase58(),rewardReserveAddress({programId,vault:addresses.vault,asset:'SOL'}).toBase58(),addresses.cycle.toBase58(),recipient,addresses.payment.toBase58(),SystemProgram.programId.toBase58()];
  const head=Buffer.alloc(24);discriminator('global:payout_reward_sol').copy(head);head.writeBigUInt64LE(BigInt(leaf.amount),8);head.writeUInt32LE(leaf.index,16);head.writeUInt32LE(leaf.proof.length,20);
  const data=Buffer.concat([head,...leaf.proof.map(hex=>Buffer.from(hex,'hex'))]);
  const instructions=message.instructions||message.compiledInstructions||[];
  assert.equal(instructions.filter(ix=>keys[ix.programIdIndex]===programId&&isDeepStrictEqual(Array.from(ix.accounts||ix.accountKeyIndexes,index=>keys[index]),expected)&&Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data).equals(data)).length,1);
  const vi=keys.indexOf(addresses.vault.toBase58()),pi=keys.indexOf(addresses.payment.toBase58());
  assert.equal(tx.meta.preBalances[vi]-tx.meta.postBalances[vi],Number(leaf.amount));assert.equal(tx.meta.preBalances[pi],0);assert.equal(tx.meta.postBalances[pi],account.lamports);
  return {...proof,paymentAccount:addresses.payment.toBase58()};
}

export function createAutomaticPayoutVerifier({connection,programId,authority,approvedHash,
  readProgram=readProgramDataEvidence,loadCollection=loadFinalizedV3PumpCollection,loadSettlement=loadFinalizedV3Settlement,
  loadFunding=loadFinalizedV3RewardFunding,loadAutomatic=loadAutomaticPayoutProof,loadBonus=loadDailyPayment}) {
  let readiness;
  async function verifyPayoutReadiness() {
    readiness=(async()=>{assert.equal(await connection.getGenesisHash(),DEVNET_GENESIS_HASH);
      const program=await readProgram(connection,programId);assert(program.account?.executable);assert(/^[a-f0-9]{64}$/.test(approvedHash||''));assert.equal(program.sha256,approvedHash);})();
    await readiness;
  }
  async function funding(state,sourceKey,kind,level) {
    const identity=v3SourceAllocation(state,sourceKey),source=identity.collectionSignature;
    if(identity.residualPlanHash)assert(['creator','reward'].includes(kind));
    const collection=state.collections?.[source],launch=state.launches?.[collection?.mint],saved=state.v3Settlements?.[source];
    assert(launchV3(launch)&&launch.pumpFeeRoute.programId===programId&&launch.pumpFeeRoute.initialAuthority===authority);
    assert(collection.status==='collected'&&collection.onchainVerified===true&&collection.programId===programId&&collection.scope==='per-mint-v3'&&collection.cluster==='devnet');
    assert(saved?.status==='finalized'&&saved.mint===collection.mint&&saved.collectionSignature===source);
    const receipt=await loadCollection({connection,signature:source,programId,mint:collection.mint,launch});
    assert(receipt&&receipt.signature===source&&receipt.router===collection.router&&receipt.claimId.toString('hex')===collection.claimId&&String(receipt.expectedLamports)===String(collection.collectedLamports));
    const settlement=await loadSettlement({connection,signature:saved.settlementSignature,programId,mint:collection.mint,authority,creator:launch.creatorWallet,claimId:receipt.claimId,expectedLamports:receipt.expectedLamports,split:launch.pumpFeeRoute.protocolSplit,includePosition:Boolean(identity.residualPlanHash)||saved.allocationPlan?.allocationVersion===2});assert(settlement);
    let plan=v3AllocationPlan({launch,settlement:{...settlement,position:saved.allocationPlan?.allocationVersion===2?settlement.position:undefined,programId,collectionSignature:source,settlementSignature:saved.settlementSignature}});assert(isDeepStrictEqual(plan,saved.allocationPlan));
    if(identity.residualPlanHash){assert(settlement.position);plan=v3ResidualAllocation({state,...identity,canonicalTarget:v3AllocationPlan({launch,settlement:{...settlement,programId,collectionSignature:source,settlementSignature:saved.settlementSignature}})}).allocation;}
    const bucket=kind==='creator'?'v3CreatorWalletPayout':kind==='referral'?'v3ReferralPayouts':kind==='operations'?'v3OperationsPayout':kind==='community'?'v3CommunityFunding':'v3CreatorRewardFunding';
    const row=state[bucket]?.[kind==='referral'?`${source}:${level}`:sourceKey];assert(row?.status==='finalized'&&row.balanceDeltaVerified===true&&row.mint===collection.mint);
    if(identity.residualPlanHash){assert.equal(row.residualPlanHash,identity.residualPlanHash);assert.equal(row.protectedPolicy,true);}
    const reward=deriveCommunityRewardVaultV3(programId,collection.mint,authority).toBase58();
    const entitlement=kind==='referral'?v3ReferralEntitlement({settlement:saved,plan,level}):null;
    const amount=kind==='creator'?plan.creatorDirected.walletLamports:kind==='referral'?entitlement?.amount:kind==='operations'?plan.protocol.operationsLamports:kind==='community'?plan.protocol.communityLamports:String(BigInt(plan.creatorDirected.holderLamports)+BigInt(plan.creatorDirected.xLamports));
    const recipient=kind==='creator'?launch.creatorWallet:kind==='referral'?entitlement?.recipient:kind==='operations'?row.recipient:reward;
    const category=kind==='referral'?level+1:kind==='operations'?1:kind==='community'?5:0;
    assert.equal(row.amount,amount);assert.equal(row.recipient,recipient);assert.equal(row.category,category);
    const idKind=kind==='creator'?'creator-wallet':kind==='referral'?`referral-${level}`:kind==='operations'?'operations':kind==='community'?'community':'creator-reward';
    const withdrawalId=identity.residualPlanHash?residualDisbursementId(idKind,saved.settlementSignature,identity.residualPlanHash):v3DisbursementId(idKind,saved.settlementSignature);
    const proof=await loadFunding({connection,signature:row.signature,programId,mint:collection.mint,authority,creator:launch.creatorWallet,initialAuthority:authority,split:launch.pumpFeeRoute.protocolSplit,withdrawalId,category,amount,recipient,protectedPolicy:row.protectedPolicy===true,beneficiary:kind==='creator'?0:kind==='referral'?level+3:kind==='operations'?3:kind==='community'?7:1,holderAmount:kind==='reward'?plan.creatorDirected.holderLamports:0n});
    assert(proof?.balanceDeltaVerified&&proof.signature===row.signature);return {proof,plan,row};
  }
  async function verifyAutomaticPayout(record,{state,rewardState}) {
    await(readiness||verifyPayoutReadiness());
    const launch=state.launches?.[record.mint];assert(launchV3(launch)&&launch.pumpFeeRoute.programId===programId);
    let proof;
    if(record.kind==='bonus') {
      const selection=dailyPaymentCandidates({dailyBonusSnapshots:{[record.snapshotId]:rewardState.dailyBonusSnapshots[record.snapshotId]}});
      const candidate=selection.candidates.find(row=>row.recipient===record.recipient&&row.source.collectionSignature===record.source&&row.payment.signature===record.signature);assert(candidate);
      const verified=await funding(state,record.source,'community');
      assert.equal(verified.proof.signature,candidate.payout.fundingSignature);
      assert.equal(verified.proof.amount,candidate.source.amountLamports);
      proof=await loadBonus({connection,state,candidate});
    } else if(['holder','x'].includes(record.kind)) {
      const schedule=rewardState.schedules?.[record.scheduleId];assert(schedule?.mint===record.mint&&schedule.kind===record.kind&&schedule.asset==='SOL');
      if(record.kind==='holder') {
        assert(schedule.poolIds?.length);
        for(const id of schedule.poolIds){assert(id.startsWith('v3:'));const verified=await funding(state,id.slice(3),'reward');const pool=rewardState.rewardPools?.[id];
          assert(pool?.status==='assigned'&&pool.balanceDeltaVerified===true&&pool.mint===record.mint&&verified.proof.mint===record.mint&&pool.scheduleId===record.scheduleId&&pool.fundingSignature===verified.proof.signature&&pool.amount===verified.plan.creatorDirected.holderLamports);}
      } else {
        const verified=await funding(state,schedule.sourceId,'reward'),claim=state.v3XClaims?.[schedule.sourceId];
        assert(claim?.status==='paid'&&claim.wallet===record.recipient&&claim.payment?.signature===record.signature&&claim.fundingSignature===verified.proof.signature&&claim.amountLamports===verified.plan.creatorDirected.xLamports&&claim.xUserId===String(launch.xUserId));
        assert.equal(schedule.manifest.leaves.length,1);assert.equal(schedule.manifest.totalAmount,claim.amountLamports);
      }
      proof=await loadAutomatic({connection,programId,authority,schedule,recipient:record.recipient});
    } else proof=(await funding(state,record.source,record.kind,record.level)).proof;
    assert(proof&&(!record.signature||proof.signature===record.signature)&&(proof.to||proof.recipient)===record.recipient&&Number.isSafeInteger(proof.blockTime)&&proof.blockTime>0);
    if(record.receiptId)assert.equal(proof.paymentAccount||proof.withdrawal||rewardState.schedules?.[record.scheduleId]?.payments?.[record.recipient]?.payment,record.receiptId);
    const amount=String(proof.amountLamports??proof.amount),net=String(proof.actualReceivedLamports??proof.amount),fee=String(proof.feeLamports??0),rent=String(proof.recipientRentLamports??0);
    return {mint:record.mint,recipient:record.recipient,receiptId:record.receiptId,payoutKind:record.kind,amountLamports:amount,netLamports:net,feeLamports:fee,rentLamports:rent,occurredAt:new Date(proof.blockTime*1000).toISOString(),proofs:[{signature:proof.signature,slot:proof.slot,cluster:'devnet',commitment:'finalized',verified:true}]};
  }
  return {verifyPayoutReadiness,verifyAutomaticPayout};
}
