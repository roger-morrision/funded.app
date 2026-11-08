import {PublicKey,Connection} from '@solana/web3.js';
import {unpackAccount,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {DEVELOPER_TOKEN_LOCK_PROGRAM_ID,developerLockAddresses,decodeDeveloperTokenLock} from '../../developer-token-lock.js';
import {developerLockConfig} from '../developer-token-lock.mjs';
import {scanBundleWallets} from '../bundle-wallet-detection.mjs';
import {assertRpcNetwork,requireSolanaCluster} from '../../solana-network.js';

export function createLaunchProtectionRoutes({store,solanaCluster,solanaRpcUrl,clientKey,respond,env=process.env,
  scanner=scanBundleWallets,configReader=developerLockConfig,connectionFactory=(timeoutMs=20000)=>{
    const signal=AbortSignal.timeout(timeoutMs);
    return new Connection(solanaRpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal})});
  }}){
  const scans=new Map(),pending=new Map();
  const json=(res,status,data)=>{respond(res,status,data);return true;};
  return async(req,res,url)=>{
    const match=req.method==='GET'&&/^\/api\/tokens\/([^/]+)\/launch-protection$/.exec(url.pathname);
    if(!match)return false;
    try{requireSolanaCluster(solanaCluster);}catch{return json(res,503,{error:'Unsupported launch protection network.'});}
    let mint;try{mint=new PublicKey(decodeURIComponent(match[1])).toBase58();}catch{return json(res,400,{error:'A valid mint is required.'});}
    const launch=await store.readLaunch(mint);
    if(!launch?.onchainVerified||launch.cluster!==solanaCluster)return json(res,404,{error:'A verified funded.vip launch on the selected network is required.'});
    const connection=connectionFactory();
    if(solanaCluster==='mainnet-beta')try{await assertRpcNetwork(connection,solanaCluster);}catch{return json(res,503,{error:'Launch protection RPC network could not be verified.'});}
    let tokenLock={status:'not-required-for-legacy-launch',verified:false};
    if(launch.developerTokenLock?.status==='not-selected')tokenLock={status:'not-selected',verified:true,amount:'0'};
    else if(launch.developerTokenLock?.verified){
      try{
        const programId=launch.developerTokenLock.programId||DEVELOPER_TOKEN_LOCK_PROGRAM_ID;
        const config=await configReader({connection,env,programId,cluster:solanaCluster});if(!config.ready||config.programId!==programId)throw Error('Escrow program verification is unavailable.');
        const addresses=developerLockAddresses({mint,creator:launch.creatorWallet,programId});
        const [account,vault,slot]=await Promise.all([connection.getAccountInfo(addresses.lock,'finalized'),connection.getAccountInfo(addresses.vault,'finalized'),connection.getSlot('finalized')]);
        const state=decodeDeveloperTokenLock(account,{mint,creator:launch.creatorWallet,programId});
        const tokens=unpackAccount(addresses.vault,vault,TOKEN_2022_PROGRAM_ID);
        if(state.amount!==launch.developerTokenLock.amount||!tokens.owner.equals(addresses.lock)||!tokens.mint.equals(new PublicKey(mint))
          ||tokens.delegate||tokens.closeAuthority||state.releasedAt===0&&tokens.amount<BigInt(state.amount))throw Error('Escrow custody does not match the saved launch.');
        const now=await connection.getBlockTime(slot);if(!Number.isSafeInteger(now))throw Error('Finalized chain time is unavailable.');
        tokenLock={...state,programId:config.programId,vault:addresses.vault.toBase58(),verified:true,checkedSlot:slot,
          balance:tokens.amount.toString(),status:state.releasedAt?'released':now>=state.unlockAt?'claimable':'locked',
          fundingSignature:launch.developerTokenLock.fundingSignature};
      }catch{tokenLock={status:'unavailable',verified:false,error:'Developer token custody or deployment could not be verified. Retry before signing.'};}
    }
    const prior=scans.get(mint);
    if(solanaCluster==='devnet'&&url.searchParams.get('scan')==='1'&&!pending.has(mint)&&(!prior||Date.now()-prior.at>60_000)){
      if(pending.size>=1)return json(res,429,{error:'Another launch risk scan is running. Retry shortly.',mint,tokenLock});
      if(!await store.chargeRpcRate(`launch-risk:${clientKey(req)}`,10,30,Math.floor(Date.now()/60_000)*60_000))return json(res,429,{error:'Risk scan refresh limit reached.',mint,tokenLock});
      if(pending.size>=1)return json(res,429,{error:'Another launch risk scan is running. Retry shortly.',mint,tokenLock});
      const task=scanner({connection:connectionFactory(60000),launch,excludedFunders:String(env.FUNDED_BUNDLE_SHARED_SERVICE_FUNDERS||'').split(',').filter(Boolean)})
        .then(data=>scans.set(mint,{at:Date.now(),data})).catch(()=>scans.set(mint,{at:Date.now(),data:{status:'unavailable',bundleConfirmed:false,coverage:{status:'unavailable'},explanation:'Finalized history could not be verified. No safety assessment is available.'}}))
        .finally(()=>pending.delete(mint));
      pending.set(mint,task);
      while(scans.size>100)scans.delete(scans.keys().next().value);
    }
    return json(res,200,{mint,cluster:solanaCluster,creatorWallet:launch.creatorWallet,creatorFeesLocked:false,tokenLock,
      bundleDetection:{...(scans.get(mint)?.data||{status:'not-scanned',bundleConfirmed:false}),scanning:pending.has(mint),cachedAt:scans.get(mint)?.at||null}});
  };
}
