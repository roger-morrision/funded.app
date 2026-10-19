import { loadFinalizedV3RewardFunding } from './v3-reward-funding-proof.mjs';
import { v3ReferralEntitlement } from './v3-referral-entitlement.mjs';
import { v3DisbursementId } from './v3-disbursement-id.mjs';

const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const key = value => typeof value === 'string' ? value : value?.pubkey ? key(value.pubkey) : value?.toBase58?.();

// Public aggregates never include recipients, referral levels or graph edges.
export async function v3ReferralPaymentSummary({ state, connection, cluster,
  loadFunding = loadFinalizedV3RewardFunding, proofCache = new Map(), onVerified = () => {} }) {
  const candidates = Object.entries(state.v3ReferralPayouts || {}).filter(([, row]) => row?.status === 'finalized');
  let paid = 0n, count = 0, unavailable = 0;
  const seen = new Set();
  for (let offset = 0; offset < candidates.length; offset += 4) {
    await Promise.all(candidates.slice(offset, offset + 4).map(async ([id, row]) => {
      try {
        const source = row.collectionSignature, launch = state.launches?.[row.mint];
        const collection = state.collections?.[source], settlement = state.v3Settlements?.[source];
        const route = launch?.pumpFeeRoute, plan = settlement?.allocationPlan;
        const entitlement = v3ReferralEntitlement({ settlement, plan, level:row.level });
        if (cluster !== 'devnet' || id !== `${source}:${row.level}` || !signature.test(row.signature || '')
          || !signature.test(settlement?.settlementSignature || '') || !address.test(row.mint || '')
          || launch?.cluster !== cluster || launch.onchainVerified !== true || route?.scope !== 'per-mint-v3'
          || !address.test(route.programId || '') || !address.test(route.initialAuthority || '')
          || collection?.signature !== source || collection.mint !== row.mint || collection.cluster !== cluster
          || collection.scope !== 'per-mint-v3' || collection.programId !== route.programId
          || collection.status !== 'collected' || collection.onchainVerified !== true
          || settlement?.status !== 'finalized' || settlement.mint !== row.mint
          || settlement.collectionSignature !== source || plan?.status !== 'allocated-not-funded'
          || !entitlement || row.recipient !== entitlement.recipient || String(row.amount) !== entitlement.amount
          || row.category !== row.level + 1 || row.programId !== route.programId || row.balanceDeltaVerified !== true)
          throw new Error('Referral receipt does not match its frozen entitlement.');
        const cacheKey = JSON.stringify({ row, route, creator:launch.creatorWallet,
          settlement:settlement.settlementSignature, entitlement });
        let proof = proofCache.get(cacheKey);
        if (!proof) {
          const transaction = await connection.getTransaction(row.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
          const authority = key(transaction?.transaction?.message?.accountKeys?.[0]
            || transaction?.transaction?.message?.staticAccountKeys?.[0]);
          if (!address.test(authority || '')) throw new Error('Referral transaction authority unavailable.');
          proof = await loadFunding({ connection, transaction, signature:row.signature,
            programId:route.programId, mint:row.mint, authority, creator:launch.creatorWallet,
            initialAuthority:route.initialAuthority, split:route.protocolSplit,
            withdrawalId:v3DisbursementId(`referral-${row.level}`, settlement.settlementSignature),
            category:row.category, amount:row.amount, recipient:row.recipient,
            protectedPolicy:row.protectedPolicy === true, beneficiary:row.level + 3, holderAmount:0n });
          if (!proof || proof.signature !== row.signature || proof.recipient !== row.recipient
            || proof.mint !== row.mint || proof.programId !== route.programId || proof.category !== row.category
            || proof.amount !== String(row.amount) || proof.balanceDeltaVerified !== true
            || !Number.isSafeInteger(proof.slot) || proof.slot <= 0 || !address.test(proof.withdrawal || ''))
            throw new Error('Finalized referral payment proof unavailable.');
          if (proofCache.size >= 5_000) proofCache.clear();
          proofCache.set(cacheKey, proof);
        }
        const identity = `${row.programId}:${proof.withdrawal}`;
        if (!seen.has(identity)) {
          seen.add(identity); paid += BigInt(proof.amount); count++;
          onVerified({signature:proof.signature,to:proof.recipient,amountLamports:proof.amount});
        }
      } catch { unavailable++; }
    }));
  }
  return { status:unavailable ? 'partial' : 'verified', paidLamports:String(paid),
    payoutCount:count, checkedCount:candidates.length, unavailableCount:unavailable };
}
