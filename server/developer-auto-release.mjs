import {PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {unpackAccount,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {SharedRpcConnection} from './rpc-connection.mjs';
import {developerLockConfig} from './developer-token-lock.mjs';
import {developerLockAddresses,decodeDeveloperTokenLock,developerReleaseInstructions,DEVELOPER_TOKEN_LOCK_PROGRAM_ID} from '../developer-token-lock.js';
import {verifyDeveloperRelease} from '../developer-token-release.js';
import {executeDeveloperRelease} from './developer-release-journal.mjs';

export function createDeveloperAutoRelease({store,solanaCluster,solanaRpcUrl,v3AuthorityKeypair,env=process.env,logger=console,
  connection=new SharedRpcConnection(solanaRpcUrl,'finalized'),configReader=developerLockConfig,execute=executeDeveloperRelease,
  scheduleTimeout=setTimeout,now=Date.now}) {
  const enabled=solanaCluster==='devnet'&&env.FUNDED_DEVELOPER_AUTO_RELEASE_ENABLED==='true'&&env.FUNDED_API_ONLY!=='true';
  let running=false,stopped=false,timer,cursor=0;
  async function tick(){
    if(!enabled||running||stopped)return;running=true;
    let examined=0,released=0,pending=0;const failures=[];
    try{
      if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Automatic developer release requires Devnet.');
      const authority=v3AuthorityKeypair();if(!authority)throw Error('Automatic release payer unavailable.');
      const state=await store.read();
      const launches=Object.values(state.launches||{}).filter(l=>l.onchainVerified===true&&l.cluster==='devnet'&&l.developerTokenLock?.verified===true
        &&/^[1-9]\d*$/.test(l.developerTokenLock.amount||'')&&l.creatorWallet);
      const candidates=launches.filter(l=>state.developerTokenReleases?.[`${l.developerTokenLock.programId||DEVELOPER_TOKEN_LOCK_PROGRAM_ID}:${l.mint}`]?.status!=='finalized');
      const configs=new Map();
      for(let i=0;i<Math.min(candidates.length,4)&&!stopped;i++){
        const launch=candidates[(cursor+i)%candidates.length];examined++;
        try{
          const mint=launch.mint,creator=launch.creatorWallet,programId=launch.developerTokenLock.programId||DEVELOPER_TOKEN_LOCK_PROGRAM_ID;
          let config=configs.get(programId);if(!config){config=await configReader({connection,env,programId,cluster:solanaCluster});configs.set(programId,config);}
          if(!config.ready||config.programId!==programId)throw Error('Escrow deployment verification unavailable.');
          const addresses=developerLockAddresses({mint,creator,programId});
          const [account,vault,slot]=await Promise.all([connection.getAccountInfo(addresses.lock,'finalized'),connection.getAccountInfo(addresses.vault,'finalized'),connection.getSlot('finalized')]);
          const lock=decodeDeveloperTokenLock(account,{mint,creator,programId});
          if(lock.amount!==launch.developerTokenLock.amount)throw Error('Saved developer allocation differs.');
          const saved=state.developerTokenReleases?.[`${programId}:${mint}`];
          if(lock.releasedAt&&!saved?.signature)continue;
          const chainTime=await connection.getBlockTime(slot);if(!Number.isSafeInteger(chainTime))throw Error('Finalized chain time unavailable.');
          if(chainTime<lock.unlockAt)continue;
          const tokens=unpackAccount(addresses.vault,vault,TOKEN_2022_PROGRAM_ID);
          if(!tokens.owner.equals(addresses.lock)||!tokens.mint.equals(new PublicKey(mint))||tokens.delegate||tokens.closeAuthority
            ||!lock.releasedAt&&tokens.amount<BigInt(lock.amount))throw Error('Developer escrow custody differs.');
          const payer=authority.publicKey.toBase58();
          const result=await execute({store,connection,authority,intent:{cluster:'devnet',programId,mint,creator,payer,amount:lock.amount,unlockAt:lock.unlockAt,approvedHash:config.programDataSha256},
            prepare:async()=>{
              const latest=await connection.getLatestBlockhash('finalized');
              const rentLamports=await connection.getAccountInfo(addresses.source,'finalized')?0:await connection.getMinimumBalanceForRentExemption(512,'finalized');
              return {transaction:new VersionedTransaction(new TransactionMessage({payerKey:authority.publicKey,recentBlockhash:latest.blockhash,
                instructions:developerReleaseInstructions({mint,creator,payer,programId})}).compileToV0Message()),lastValidBlockHeight:latest.lastValidBlockHeight,rentLamports};
            },prove:row=>verifyDeveloperRelease({connection,mint,creator,receipt:{...row,programId,payer,amount:lock.amount}})});
          if(result.status==='finalized')released++;else pending++;
        }catch(error){failures.push({mint:launch.mint,reason:safeReason(error)});break;}
      }
      cursor=(cursor+Math.max(1,examined))%Math.max(1,candidates.length);
    }catch(error){failures.push({reason:safeReason(error)});}
    finally{
      try{await store.update(state=>{(state.developerTokenReleases||={}).worker={cluster:'devnet',status:failures.length?'degraded':'ready',checkedAt:now(),examined,released,pending,failures};});}
      finally{running=false;}
      if(failures.length)logger.error(JSON.stringify({event:'developer_auto_release_degraded',failures}));
    }
    return {examined,released,pending,failures};
  }
  const safeReason=error=>String(error?.message||error).replace(/https?:\/\/[^\s"']+/g,'[redacted-url]').slice(0,160);
  function schedule(){timer=scheduleTimeout(async()=>{try{await tick();}catch(error){logger.error(safeReason(error));}if(!stopped)schedule();},30000);timer.unref?.();}
  return {enabled,tick,start(){if(enabled&&!timer)schedule();},stop(){stopped=true;clearTimeout(timer);}};
}
