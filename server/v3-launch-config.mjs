import { Connection, PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { activeProtocolFeeSplit } from './active-protocol-fee.mjs';
import { verifyFeeRouterAccount } from '../fee-router.js';
import { readProgramDataEvidence, DEVNET_GENESIS_HASH } from './automatic-reward-chain.mjs';
import { rewardServiceHealth } from './reward-service-health.mjs';

// V3 fixes the seven category budgets on chain, but its disbursement
// instruction does not commit the creator/holder/X shares or the operations
// and referral beneficiaries. No environment setting can waive this gate.
export const V3_BENEFICIARY_ROUTING_ON_CHAIN_ENFORCED = false;
export const V3_BENEFICIARY_RELEASE_BLOCKER =
  'V3 disbursement does not enforce creator/holder/X shares and approved operations/referral recipients on chain';

export function createV3LaunchConfig({ solanaCluster, solanaRpcUrl, automaticRewardStore, store,
  v3AuthorityKeypair, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  programEvidence = readProgramDataEvidence, verifyRouter = verifyFeeRouterAccount }) {
  return async () => {
    const reasons = [];
    if (!V3_BENEFICIARY_ROUTING_ON_CHAIN_ENFORCED)
      reasons.push(V3_BENEFICIARY_RELEASE_BLOCKER);
    const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
    const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').trim().toLowerCase();
    if (solanaCluster !== 'devnet') reasons.push('V3 launches require Devnet');
    for (const [name, label] of [
      ['FUNDED_V3_LAUNCH_ENABLED', 'V3 launch registration'],
      ['FUNDED_V3_COLLECTION_ENABLED', 'V3 fee collection'],
      ['FUNDED_V3_SETTLEMENT_ENABLED', 'V3 settlement'],
    ]) if (env[name] !== 'true') reasons.push(`${label} is disabled`);
    if (env.FUNDED_V3_HOLDER_WORKER_ENABLED !== 'true')
      reasons.push('V3 holder payout worker is disabled');
    else {
      try {
        const health = rewardServiceHealth((await automaticRewardStore.read()).serviceStatus);
        if (!health.healthy) reasons.push('V3 holder payout worker has no fresh verified readiness');
      } catch { reasons.push('V3 holder payout worker readiness is unavailable'); }
    }
    if (env.FUNDED_V3_BUYBACK_ENABLED !== 'true') reasons.push('V3 buyback route is disabled');
    const lookupAddresses = [env.FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE,
      env.FUNDED_V3_BUYBACK_LOOKUP_TABLE];
    if (lookupAddresses.some(value => {
      if (!value) return true;
      try { new PublicKey(value); return false; } catch { return true; }
    })) reasons.push('V3 launch reserve and buyback lookup tables are not configured');
    if (!programId || !/^[a-f0-9]{64}$/.test(approvedHash)) reasons.push('Approved V3 program is not configured');
    let authority = null;
    try { authority = v3AuthorityKeypair?.(); } catch { reasons.push('V3 authority signer is invalid'); }
    if (!authority?.publicKey) reasons.push('V3 authority signer is unavailable');
    if (!reasons.length) {
      try {
        const connection = connectionFactory(solanaRpcUrl);
        const [genesis, evidence, router, reserveLookup, buybackLookup] = await Promise.all([
          connection.getGenesisHash(), programEvidence(connection, programId),
          verifyRouter({ connection, programId, commitment:'finalized' }),
          connection.getAddressLookupTable(new PublicKey(lookupAddresses[0]), { commitment:'finalized' }),
          connection.getAddressLookupTable(new PublicKey(lookupAddresses[1]), { commitment:'finalized' }),
        ]);
        if (genesis !== DEVNET_GENESIS_HASH || !evidence.account?.executable
          || evidence.sha256 !== approvedHash || !router.verified
          || !router.authority.equals(authority.publicKey)) reasons.push('Approved V3 program or authority is not verified on Devnet');
        if (!reserveLookup.value || !buybackLookup.value
          || reserveLookup.value.state.deactivationSlot !== BigInt('18446744073709551615')
          || buybackLookup.value.state.deactivationSlot !== BigInt('18446744073709551615'))
          reasons.push('V3 launch reserve or buyback lookup table is not active on Devnet');
      } catch { reasons.push('V3 program verification is unavailable'); }
    }
    const protocolSplit = store ? await activeProtocolFeeSplit(store).catch(() => null) : PROTOCOL_FEE_SPLIT;
    return { ready:reasons.length === 0 && Boolean(protocolSplit), cluster:solanaCluster,
      beneficiaryRoutingOnChainEnforced:V3_BENEFICIARY_ROUTING_ON_CHAIN_ENFORCED,
      programId:programId || null, initialAuthority:authority?.publicKey.toBase58() || null,
      protocolSplit:protocolSplit || PROTOCOL_FEE_SPLIT, reasons:protocolSplit ? reasons : [...reasons, 'Active fee policy is unavailable'] };
  };
}
