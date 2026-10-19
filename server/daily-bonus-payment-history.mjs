import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import bs58 from 'bs58';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { rewardAddresses, rewardReserveAddress } from './automatic-reward-chain.mjs';
import { bonusHash, dailyBonusManifest } from './daily-bonus.mjs';
import { verifyBonusSnapshotRevision } from './daily-bonus-reconciliation.mjs';

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const discriminator = (space, name) => createHash('sha256').update(`${space}:${name}`).digest().subarray(0,8);
const address = key => typeof key === 'string' ? key : key?.pubkey ? address(key.pubkey) : key?.toBase58?.();
const safe = value => /^(0|[1-9]\d*)$/.test(String(value)) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
const accountData = (account, program, name, size) => {
  const data = Buffer.from(account?.data || []);
  if (address(account?.owner) !== program || data.length !== size
    || !data.subarray(0,8).equals(discriminator('account',name))) throw new Error('Daily payment account proof is unavailable.');
  return data;
};

// Select all recorded receipts, including recovered payments with only a PDA.
// An invalid immutable snapshot is missing evidence, never an empty history.
export function dailyPaymentCandidates(ledger) {
  const candidates=[]; let unavailable=0, checked=0;
  for (const row of Object.values(ledger.dailyBonusSnapshots || {})) {
    const saved=Object.entries(row.payouts || {}).flatMap(([source,payout]) =>
      Object.entries(payout.payments || {}).filter(([,payment]) => payment?.finalized === true)
        .map(([recipient,payment]) => ({source,payout,recipient,payment})));
    checked+=saved.length;
    if (!saved.length) continue;
    try {
      verifyBonusSnapshotRevision(row);
      const snapshot=row.snapshot;
      for (const record of saved) {
        const source=snapshot.sources.find(source=>source.collectionSignature === record.source);
        const manifest=source && dailyBonusManifest(snapshot,source);
        const leaf=manifest?.leaves.find(leaf=>leaf.recipient === record.recipient);
        if (!leaf || !isDeepStrictEqual(record.payout.manifest,manifest)
          || record.payment.balanceDeltaVerified !== true || record.payment.amount !== leaf.amount) {unavailable++; continue;}
        candidates.push({...record,source,snapshot,manifest,leaf});
      }
    } catch { unavailable+=saved.length; }
  }
  return {candidates,unavailable,checked};
}

function transactionProof(tx, signature, candidate, program, addresses) {
  const {leaf,manifest,snapshot,source}=candidate;
  if (!tx || tx.meta?.err !== null || tx.transaction?.signatures?.[0] !== signature
    || !Number.isSafeInteger(tx.slot) || tx.slot <= 0 || !Number.isSafeInteger(tx.blockTime)
    || tx.blockTime <= 0) return null;
  const message=tx.transaction.message;
  const keys=[...(message.accountKeys || message.staticAccountKeys || []),
    ...(tx.meta.loadedAddresses?.writable || []),...(tx.meta.loadedAddresses?.readonly || [])].map(address);
  if (new Set(keys).size !== keys.length || !keys[0] || !(message.header?.numRequiredSignatures > 0)) return null;
  const expected=[keys[0],addresses.vault,addresses.reserve,addresses.cycle,leaf.recipient,addresses.payment,SystemProgram.programId].map(address);
  const data=Buffer.alloc(24);
  discriminator('global','payout_reward_sol').copy(data);
  data.writeBigUInt64LE(BigInt(leaf.amount),8); data.writeUInt32LE(leaf.index,16); data.writeUInt32LE(leaf.proof.length,20);
  const expectedData=Buffer.concat([data,...leaf.proof.map(hex=>Buffer.from(hex,'hex'))]);
  const instructions=[...(message.instructions || message.compiledInstructions || []),
    ...(tx.meta.innerInstructions || []).flatMap(row=>row.instructions)];
  const matching=instructions.filter(ix=>{
    if (keys[ix.programIdIndex] !== program) return false;
    const actual=Array.from(ix.accounts || ix.accountKeyIndexes || [],index=>keys[index]);
    const bytes=Buffer.from(typeof ix.data === 'string' ? bs58.decode(ix.data) : ix.data || []);
    return isDeepStrictEqual(actual,expected) && bytes.equals(expectedData);
  });
  if (matching.length !== 1) return null;
  const {preBalances:pre,postBalances:post,fee}=tx.meta;
  if (!Array.isArray(pre) || pre.length !== keys.length || post?.length !== keys.length
    || !pre.every(n=>Number.isSafeInteger(n)&&n>=0) || !post.every(n=>Number.isSafeInteger(n)&&n>=0)
    || !Number.isSafeInteger(fee) || fee < 0 || !safe(leaf.amount)) return null;
  const vault=keys.indexOf(address(addresses.vault)), recipient=keys.indexOf(leaf.recipient), payment=keys.indexOf(address(addresses.payment));
  if ([vault,recipient,payment].some(index=>index<0) || pre[payment] !== 0 || post[payment] <= 0) return null;
  const gross=Number(leaf.amount), net=post[recipient]-pre[recipient];
  if (pre[vault]-post[vault] !== gross || net <= 0 && recipient !== 0
    || net !== gross-(recipient === 0 ? fee+post[payment] : 0)) return null;
  return {signature,source:'daily-bonus',to:leaf.recipient,mint:source.mint,day:snapshot.day,
    amountLamports:gross,actualReceivedLamports:net,feeLamports:fee,feePayer:keys[0],
    recipientRentLamports:recipient === 0 ? post[payment] : 0,
    slot:tx.slot,blockTime:tx.blockTime,paymentAccount:address(addresses.payment),cycleId:manifest.cycleId};
}

export async function loadDailyPayment({connection,state,candidate}) {
  const {source,snapshot,payout,payment,manifest,leaf}=candidate;
  const launch=state.launches?.[source.mint], route=launch?.pumpFeeRoute;
  const collection=state.collections?.[source.collectionSignature], settled=state.v3Settlements?.[source.collectionSignature];
  const funding=state.v3CommunityFunding?.[source.collectionSignature];
  if (launch?.onchainVerified !== true || launch.cluster !== 'devnet' || route?.scope !== 'per-mint-v3'
    || launch.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version !== 1
    || collection?.mint !== source.mint || collection.signature !== source.collectionSignature
    || collection.cluster !== 'devnet' || collection.programId !== route.programId
    || collection.scope !== 'per-mint-v3' || collection.onchainVerified !== true || collection.status !== 'collected'
    || settled?.status !== 'finalized' || settled.mint !== source.mint
    || settled.collectionSignature !== source.collectionSignature || settled.settlementSignature !== source.settlementSignature
    || funding?.status !== 'finalized' || funding.balanceDeltaVerified !== true || funding.mint !== source.mint
    || funding.amount !== source.amountLamports || funding.signature !== payout.fundingSignature)
    throw new Error('Daily payment lacks its matching finalized source.');
  const program=route.programId, vaultKey=new PublicKey(funding.recipient);
  const vault=accountData(await connection.getAccountInfo(vaultKey,'finalized'),program,'RewardVault',73);
  const authority=new PublicKey(vault.subarray(8,40)), mint=new PublicKey(vault.subarray(40,72));
  const addresses=rewardAddresses({programId:program,authority,mint:source.mint,cycleId:manifest.cycleId,recipient:leaf.recipient});
  addresses.reserve=rewardReserveAddress({programId:program,vault:addresses.vault,asset:'SOL'});
  if (mint.toBase58() !== source.mint || !addresses.vault.equals(vaultKey)
    || payout.cycle !== addresses.cycle.toBase58() || payment.payment !== addresses.payment.toBase58())
    throw new Error('Daily payment PDA conflicts with its manifest.');
  const [cycleAccount,paymentAccount]=await Promise.all([addresses.cycle,addresses.payment].map(key=>connection.getAccountInfo(key,'finalized')));
  const cycle=accountData(cycleAccount,program,'RewardCycle',174), receipt=accountData(paymentAccount,program,'RewardPayment',100);
  if (!cycle.subarray(8,40).equals(vaultKey.toBuffer()) || cycle.subarray(40,72).toString('hex') !== manifest.cycleId
    || cycle.subarray(72,104).toString('hex') !== manifest.root || !cycle.subarray(104,136).equals(Buffer.alloc(32))
    || String(cycle.readBigUInt64LE(136)) !== manifest.totalAmount || cycle.readBigUInt64LE(144) < BigInt(leaf.amount)
    || cycle.readBigInt64LE(152) !== BigInt(snapshot.end) || cycle.readBigInt64LE(160) !== BigInt(snapshot.end)
    || cycle.readUInt32LE(168) !== manifest.leaves.length || cycle[173] !== 1
    || !receipt.subarray(8,40).equals(addresses.cycle.toBuffer()) || !receipt.subarray(40,72).equals(new PublicKey(leaf.recipient).toBuffer())
    || String(receipt.readBigUInt64LE(72)) !== leaf.amount || receipt.readUInt32LE(80) !== leaf.index
    || receipt.readBigInt64LE(84) < BigInt(snapshot.end)
    || receipt.readBigInt64LE(84) > BigInt(Number.MAX_SAFE_INTEGER)
    || receipt.readBigUInt64LE(92) !== BigInt(leaf.amount)) throw new Error('Daily payment account conflicts with its manifest.');
  let signatures;
  if (payment.signature != null) {
    if (!SIGNATURE.test(payment.signature)) throw new Error('Invalid daily payment signature.');
    signatures=[payment.signature];
  } else {
    signatures=(await connection.getSignaturesForAddress(addresses.payment,{limit:20},'finalized'))
      .filter(row=>!row.err && row.confirmationStatus === 'finalized' && SIGNATURE.test(row.signature)).map(row=>row.signature);
  }
  for (const signature of signatures) {
    const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    const proof=transactionProof(tx,signature,candidate,program,addresses);
    // paid_at is the program's Clock value; RPC blockTime is an estimate and
    // can differ even for this exact finalized transaction. The payment PDA,
    // zero pre-balance, unique instruction, Merkle leaf and balance deltas above
    // bind account creation to the transaction. Enforce the cutoff using Clock.
    if (proof) return {...proof,paidAt:Number(receipt.readBigInt64LE(84))};
  }
  throw new Error('Daily payment finalized transaction and balance evidence are unavailable.');
}

export async function dailyPaymentHistory({connection,state,selection,proofCache=new Map()}) {
  const rows=[]; let unavailable=selection.unavailable;
  for (let index=0;index<selection.candidates.length;index+=4) {
    await Promise.all(selection.candidates.slice(index,index+4).map(async candidate=>{
      try {
        const mint=candidate.source.mint, source=candidate.source.collectionSignature;
        const key=bonusHash({candidate,launch:state.launches?.[mint],collection:state.collections?.[source],
          settlement:state.v3Settlements?.[source],funding:state.v3CommunityFunding?.[source]});
        let proof=proofCache.get(key);
        if (!proof) {proof=await loadDailyPayment({connection,state,candidate});
          if (proofCache.size>=1000) proofCache.delete(proofCache.keys().next().value); proofCache.set(key,proof);}
        rows.push(proof);
      } catch {unavailable++;}
    }));
  }
  // Two snapshot aliases may reference one recovered payment. Conflicting aliases
  // are unavailable rather than letting their arrival order decide the total.
  const unique=new Map(), conflicts=new Set();
  for (const row of rows) {
    const key=`${row.signature}:${row.to}`;
    if (unique.has(key)&&!isDeepStrictEqual(unique.get(key),row)) conflicts.add(key);
    else unique.set(key,row);
  }
  for (const key of conflicts) {unique.delete(key);unavailable++;}
  return {rows:[...unique.values()],unavailable,checked:selection.checked};
}
