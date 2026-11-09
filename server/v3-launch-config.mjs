import {validateAgencyRules} from '../config/agency-rules.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { activeProtocolFeeSplit } from './active-protocol-fee.mjs';
import { verifyFeeRouterAccount } from '../fee-router.js';
import { readProgramDataEvidence, DEVNET_GENESIS_HASH } from './automatic-reward-chain.mjs';
import { rewardServiceHealth } from './reward-service-health.mjs';
import {readAgencyDeployment,agencyWorkerHealth,agencyBuybackWorkerHealth} from './agency-deployment.mjs';
import {MARKETING_AGENCY_POLICY} from '../config/marketing-agency.js';
import {readAgencyBuybackReadiness} from './agency-buyback-readiness.mjs';

// This exact Devnet ProgramData was verified against the tested protected V3
// binary and exercised with finalized disposable-wallet payouts. An operator
// setting cannot make older, unprotected program bytes eligible for launches.
export const PROTECTED_V3_PROGRAM_DATA_SHA256 =
  'f0517fce9b8361be087456be2f5e5547af23b114ca1c0cf4ebaba5a42a8bd9ca';
export const V3_BENEFICIARY_ROUTING_ON_CHAIN_ENFORCED = true;
export const V3_BENEFICIARY_RELEASE_BLOCKER =
  'Protected V3 beneficiary rules require the exact reviewed Devnet program bytes';

export function createV3LaunchConfig({ solanaCluster, solanaRpcUrl, automaticRewardStore, store,
  v3AuthorityKeypair, env = process.env,
  // Finalized ProgramData and lookup reads occasionally exceed eight seconds
  // on the reviewed Devnet RPC. Keep the bound while allowing the full proof.
  verificationTimeoutMs = 30000,
  connectionFactory = (url, { signal } = {}) => new Connection(url, {
    commitment:'finalized', disableRetryOnRateLimit:true,
    fetch:(target, options) => fetch(target, { ...options,
      signal:options?.signal ? AbortSignal.any([signal,options.signal]) : signal }),
  }),
  programEvidence = readProgramDataEvidence, verifyRouter = verifyFeeRouterAccount,readAgency=readAgencyDeployment,
  readBuybackReadiness=readAgencyBuybackReadiness }) {
  let pending;
  const check = async () => {
    const reasons = [];
    const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
    const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').trim().toLowerCase();
    const agencyEnabled=env.FUNDED_V3_AGENCY_ENABLED==='true';let agencyDeployment=null;
    let buybackReadiness={ready:false,reason:'Agency deployment and worker readiness are unverified.'};
    let beneficiaryRoutingOnChainEnforced = !agencyEnabled&&V3_BENEFICIARY_ROUTING_ON_CHAIN_ENFORCED
      && approvedHash === PROTECTED_V3_PROGRAM_DATA_SHA256;
    if (!beneficiaryRoutingOnChainEnforced&&!agencyEnabled) reasons.push(V3_BENEFICIARY_RELEASE_BLOCKER);
    if(agencyEnabled&&env.FUNDED_V3_AGENCY_NORMAL_FLOWS_ENABLED!=='true')reasons.push('Agency normal flows await verified Devnet acceptance');
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
        const workerState=await (automaticRewardStore.readWorkerHealth?.() || automaticRewardStore.read());
        const health = rewardServiceHealth(workerState.serviceStatus);
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
    try { if(solanaCluster==='devnet')authority = v3AuthorityKeypair?.(); } catch { reasons.push('V3 authority signer is invalid'); }
    if (!authority?.publicKey) reasons.push('V3 authority signer is unavailable');
    if (!reasons.length) {
      const controller = new AbortController();
      let timer;
      try {
        const connection = connectionFactory(solanaRpcUrl, { signal:controller.signal });
        const programRead=programEvidence(connection,programId),routerRead=verifyRouter({connection,programId,commitment:'finalized'});
        const checks = Promise.all([
          connection.getGenesisHash(), programRead,routerRead,
          connection.getAddressLookupTable(new PublicKey(lookupAddresses[0]), { commitment:'finalized' }),
          connection.getAddressLookupTable(new PublicKey(lookupAddresses[1]), { commitment:'finalized' }),
          agencyEnabled?readAgency({connection,programId,approvedHash,authority:authority.publicKey,
            readProgram:()=>programRead,verifyRouter:()=>routerRead}):null,
          agencyEnabled&&store?store.read():null,
          agencyEnabled?readBuybackReadiness({connection,programId,env}):null,
        ]);
        // Cap the complete verification, including sequential ProgramData reads.
        // Slow RPC must close readiness, not leave public capability requests pending.
        const [genesis, evidence, router, reserveLookup, buybackLookup,agency,agencyState,priceReadiness] = await Promise.race([
          checks,
          new Promise((_,reject) => { timer=setTimeout(() => {
            controller.abort(); reject(new Error('V3 verification timed out'));
          },verificationTimeoutMs); }),
        ]);
        if (genesis !== DEVNET_GENESIS_HASH || !evidence.account?.executable
          || evidence.sha256 !== approvedHash || !router.verified
          || !router.authority.equals(authority.publicKey)) reasons.push('Approved V3 program or authority is not verified on Devnet');
        if (!reserveLookup.value || !buybackLookup.value
          || reserveLookup.value.state.deactivationSlot !== BigInt('18446744073709551615')
          || buybackLookup.value.state.deactivationSlot !== BigInt('18446744073709551615'))
          reasons.push('V3 launch reserve or buyback lookup table is not active on Devnet');
        if(agencyEnabled){
          agencyDeployment=agency;beneficiaryRoutingOnChainEnforced=agency?.verified===true;
          if(agency.rules?.source==='on-chain-snapshot'){
            const published=agencyState?.adminSettings?.protocolFeePolicy;
            if(published?.configRevision!==agency.revision||!published?.rules
              ||JSON.stringify(validateAgencyRules(published.rules))!==JSON.stringify(validateAgencyRules(agency.rules)))
              reasons.push('Published launch settings differ from the verified on-chain configuration');
          }

          const health={programId,approvedHash,authority:authority.publicKey.toBase58(),revision:agency.revision,build:env.FUNDED_BUILD_ID};
          const buybacksReady=env.FUNDED_V3_AGENCY_BUYBACK_ENABLED==='true'&&agencyBuybackWorkerHealth(agencyState||{},health);
          const fullReady=env.X_POST_ENABLED==='true'&&env.X_POST_ACCOUNT_STATUS==='active'&&agencyWorkerHealth(agencyState||{},health);
          buybackReadiness=buybacksReady||fullReady?priceReadiness:
            {ready:false,reason:'Milestone buyback worker has no fresh verified readiness.'};
          // Optional agency execution may be intentionally paused while normal
          // launches, fee settlement and RICH buybacks remain available.
          const agencyWorkerRequired=env.FUNDED_V3_AGENCY_BUYBACK_ENABLED==='true'
            ||env.X_POST_ENABLED==='true'&&env.X_POST_ACCOUNT_STATUS==='active';
          if(agencyWorkerRequired&&!buybacksReady&&!fullReady)
            reasons.push('Agency worker has no fresh matching verified deployment readiness');
        }
      } catch { reasons.push('V3 program verification is unavailable'); }
      finally { clearTimeout(timer); controller.abort(); }
    }
    const savedSplit = store ? await activeProtocolFeeSplit(store).catch(() => null) : PROTOCOL_FEE_SPLIT;
    const protocolSplit=agencyDeployment?.protocolSplit||savedSplit;
    if(agencyDeployment&&JSON.stringify(protocolSplit)!==JSON.stringify(savedSplit))reasons.push('Published fee policy differs from the verified agency configuration');
    return { ready:reasons.length === 0 && Boolean(protocolSplit), cluster:solanaCluster,
      beneficiaryRoutingOnChainEnforced,
      programId:programId || null, initialAuthority:authority?.publicKey.toBase58() || null,
      protocolSplit:protocolSplit || PROTOCOL_FEE_SPLIT,
      ...(agencyDeployment?{agency:{version:MARKETING_AGENCY_POLICY.version,configRevision:agencyDeployment.revision,buybacks:buybackReadiness,...(agencyDeployment.rules?{rules:agencyDeployment.rules}:{})}}:{}),
      reasons:protocolSplit ? reasons : [...reasons, 'Active fee policy is unavailable'] };
  };
  // Concurrent capability and launch requests share only in-flight evidence.
  // Every later check reads fresh policy, worker health and finalized accounts.
  return () => pending ||= check().finally(() => { pending = null; });
}
