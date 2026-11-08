import {createHash} from 'node:crypto';
import {Connection,PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS,requireSolanaCluster,assertRpcNetwork} from '../solana-network.js';

const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

// An optional read-only provider serves large program accounts. It must agree
// with the transaction provider on the selected network. Callers still pin the complete hash.
export async function readProgramDataEvidence(connection,program,{
  cluster='devnet',rpcUrl=cluster==='devnet'?(process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL||''):(process.env.FUNDED_MAINNET_PROGRAM_EVIDENCE_RPC_URL||''),timeoutMs=8000,fallbackTimeoutMs=15000,
  connectionFactory=(url,signal)=>new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(target,options)=>fetch(target,{...options,signal:options?.signal?AbortSignal.any([signal,options.signal]):signal})}),
}={}) {
  requireSolanaCluster(cluster);
  const controller=new AbortController();let timer;
  const read=async()=>{
    let reader=connection;
    if(cluster==='mainnet-beta'&&!rpcUrl)await assertRpcNetwork(connection,cluster);
    if(rpcUrl) {
      const url=new URL(rpcUrl);
      if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Invalid program evidence RPC configuration.');
      reader=connectionFactory(rpcUrl,controller.signal);
      const [primary,alternate]=await Promise.all([connection.getGenesisHash(),reader.getGenesisHash()]);
      if(primary!==SOLANA_GENESIS[cluster]||alternate!==primary)throw new Error('Program evidence RPC must match the selected network and transaction provider.');
    }
    const key=new PublicKey(program),account=await reader.getAccountInfo(key,'finalized');
    if(!account?.executable)return {account,programData:null,sha256:null};
    if(account.owner.equals(LOADER)&&account.data.length>=36&&account.data.readUInt32LE(0)===2) {
      const address=new PublicKey(account.data.subarray(4,36)),programData=await reader.getAccountInfo(address,'finalized');
      if(programData&&(!programData.owner.equals(LOADER)||programData.executable||programData.data.length<45||programData.data.readUInt32LE(0)!==3))
        throw new Error('Invalid upgradeable ProgramData account.');
      return {account,programData,programDataAddress:address.toBase58(),sha256:programData?createHash('sha256').update(programData.data).digest('hex'):null};
    }
    return {account,programData:account,programDataAddress:key.toBase58(),sha256:createHash('sha256').update(account.data).digest('hex')};
  };
  if(!rpcUrl)return read();
  try {
    return await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>{
      controller.abort();reject(Object.assign(new Error('Program evidence RPC verification timed out.'),{code:'PROGRAM_EVIDENCE_TIMEOUT'}));
    },timeoutMs);})]);
  } catch(error) {
    // A slow optional provider must not disable a healthy transaction provider.
    // Re-read full finalized bytes and the network; never fall back on a bad
    // network, malformed account, or mismatched program commitment.
    if(error.code!=='PROGRAM_EVIDENCE_TIMEOUT'||fallbackTimeoutMs<=0)throw error;
    let fallbackTimer;
    try{return await Promise.race([(async()=>{
      await assertRpcNetwork(connection,cluster);
      return readProgramDataEvidence(connection,program,{rpcUrl:'',cluster});
    })(),new Promise((_,reject)=>{fallbackTimer=setTimeout(()=>reject(new Error('Program evidence fallback timed out.')),fallbackTimeoutMs);})]);}
    finally{clearTimeout(fallbackTimer);}
  } finally {clearTimeout(timer);controller.abort();}
}
