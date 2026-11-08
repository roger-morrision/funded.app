import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function mainnetReleaseVerified(evidence,programId,approvedHash,manifest){
  const reviewed=reviewedMainnetManifest(manifest);
  if(!reviewed||String(programId)!==reviewed.programId||approvedHash!==reviewed.programDataSha256)return false;
  try{
    const program=evidence.account,data=evidence.programData,bytes=Buffer.from(data?.data||[]);
    const address=PublicKey.findProgramAddressSync([new PublicKey(programId).toBuffer()],loader)[0];
    return program?.executable===true&&program.owner.equals(loader)&&program.data.length===36&&program.data.readUInt32LE(0)===2
      &&new PublicKey(program.data.subarray(4,36)).equals(address)&&evidence.programDataAddress===address.toBase58()
      &&data.executable===false&&data.owner.equals(loader)&&bytes.length>=45+reviewed.binary.bytes
      &&bytes.readUInt32LE(0)===3&&bytes[12]===1
      &&new PublicKey(bytes.subarray(13,45)).toBase58()===reviewed.upgradeAuthority
      &&evidence.sha256===approvedHash&&sha(bytes)===approvedHash
      &&bytes.subarray(45,49).equals(Buffer.from([127,69,76,70]))
      &&sha(bytes.subarray(45,45+reviewed.binary.bytes))===reviewed.binary.sha256
      &&bytes.subarray(45+reviewed.binary.bytes).every(byte=>byte===0);
  }catch{return false;}
}
