import {createHash} from 'node:crypto';
import {Connection,PublicKey} from '@solana/web3.js';
import {GENESIS_HASHES} from './service-status.mjs';

const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

// An optional read-only provider serves large program accounts. It must agree
// with the transaction provider on Devnet. Callers still pin the complete hash.
export async function readProgramDataEvidence(connection,program,{
  rpcUrl=process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL||'',timeoutMs=8000,
  connectionFactory=(url,signal)=>new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(target,options)=>fetch(target,{...options,signal:options?.signal?AbortSignal.any([signal,options.signal]):signal})}),
}={}) {
  const controller=new AbortController();let timer;
  const read=async()=>{
    let reader=connection;
    if(rpcUrl) {
      const url=new URL(rpcUrl);
      if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Invalid program evidence RPC configuration.');
      reader=connectionFactory(rpcUrl,controller.signal);
      const [primary,alternate]=await Promise.all([connection.getGenesisHash(),reader.getGenesisHash()]);
      if(primary!==GENESIS_HASHES.devnet||alternate!==primary)throw new Error('Program evidence RPC must match the transaction provider on Devnet.');
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
      controller.abort();reject(new Error('Program evidence RPC verification timed out.'));
    },timeoutMs);})]);
  } finally {clearTimeout(timer);controller.abort();}
}
