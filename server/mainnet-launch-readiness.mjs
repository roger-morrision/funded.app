import {reviewedMainnetManifest} from '../mainnet-program.js';
import {PROTOCOL_FEE_SPLIT} from '../config/protocol-fee-split.js';
import {mainnetLaunchIdentities,readMainnetLaunchContext} from './mainnet-launch-context.mjs';
import {activeProtocolFeeSplit} from './active-protocol-fee.mjs';

// Readiness is deliberately separate from launch execution. This public reader
// receives neither signer getters nor custody resolvers and never starts workers.
export function createMainnetLaunchReadiness({env,store,solanaRpcUrl,connectionFactory,
  verificationTimeoutMs=30000,release=reviewedMainnetManifest()}){
  release=structuredClone(release);
  let pending;
  const check=async()=>{
    const result={ready:false,cluster:'mainnet-beta',programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID||null,
      initialAuthority:null,beneficiaryRoutingOnChainEnforced:false,protocolSplit:PROTOCOL_FEE_SPLIT,
      reasons:['Mainnet launch execution remains disabled pending production integration and activation approval.'],
      preparation:{status:'blocked',scope:'public-program-prerequisites-only',signingEnabled:false,reason:null}};
    const controller=new AbortController();let timer;
    try{
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Timed out'));},verificationTimeoutMs);});
      // Preserve the published display policy even when production review is
      // incomplete; it remains distinct from a verified on-chain policy.
      if(store)result.protocolSplit=await Promise.race([activeProtocolFeeSplit(store),timeout]);
      try{mainnetLaunchIdentities(env,release);}catch{
        result.preparation.reason='Reviewed Mainnet release, matching program/assets, public custody roles and lookup references are required.';
        return result;
      }
      const connection=connectionFactory(solanaRpcUrl,{signal:controller.signal});
      const proof=await Promise.race([readMainnetLaunchContext({connection,env,release,store}),
        timeout]);
      result.initialAuthority=proof.operator;result.protocolSplit=proof.protocolSplit;
      result.beneficiaryRoutingOnChainEnforced=true;
      result.preparation={...result.preparation,status:'verified',proof};
    }catch{
      result.preparation.status='unavailable';
      result.preparation.reason='Finalized Mainnet program, custody roles, assets, policy or lookup tables could not be verified.';
    }finally{clearTimeout(timer);controller.abort();}
    return result;
  };
  // Coalesce concurrent reads, but never cache a successful deployment proof.
  return ()=>pending||=check().finally(()=>{pending=null;});
}
