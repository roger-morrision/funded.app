import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {PUMP_SDK,PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import {developerLockAddresses,developerLockInstruction,DEVELOPER_TOKEN_LOCK_PROGRAM_ID} from '../../developer-token-lock.js';
export const mint=Keypair.generate().publicKey.toBase58(),creator=Keypair.generate().publicKey.toBase58();
export const signature=bs58.encode(Buffer.alloc(64,1)),time=1_700_000_000;
export function eventLogs({wallet=creator,amount=100000001n,isBuy=true,program=PUMP_PROGRAM_ID.toBase58()}={}){
 const fields=PUMP_SDK.offlinePumpProgram.idl.types.find(row=>row.name==='tradeEvent').type.fields;
 const event=Object.fromEntries(fields.map(f=>[f.name,f.type==='pubkey'?PublicKey.default:f.type==='bool'?false:f.type==='string'?'':typeof f.type==='object'?[]:new BN(0)]));
 Object.assign(event,{mint:new PublicKey(mint),user:new PublicKey(wallet),tokenAmount:new BN(String(amount)),isBuy,solAmount:new BN(10000000)});
 const data=Buffer.concat([Buffer.from([189,219,127,211,78,230,97,238]),PUMP_SDK.offlinePumpProgram.coder.types.encode('tradeEvent',event)]);
 return [`Program ${program} invoke [1]`,`Program data: ${data.toString('base64')}`,`Program ${program} success`];
}
export function lockAccount({amount=1n,releasedAt=0}={}){
 const data=Buffer.alloc(105),{bump}=developerLockAddresses({mint,creator});Buffer.from('c9e00b0c19713f1d','hex').copy(data);
 new PublicKey(mint).toBuffer().copy(data,8);new PublicKey(creator).toBuffer().copy(data,40);
 data.writeBigUInt64LE(amount,72);data.writeBigInt64LE(BigInt(time),80);data.writeBigInt64LE(BigInt(time+43200),88);data.writeBigInt64LE(BigInt(releasedAt),96);data[104]=bump;
 return {data,owner:new PublicKey(DEVELOPER_TOKEN_LOCK_PROGRAM_ID)};
}
export function launchReceipt(){
 const ix=developerLockInstruction({mint,creator,amount:1n}).instruction;
 const message=new Transaction({feePayer:new PublicKey(creator),recentBlockhash:PublicKey.default.toBase58()}).add(ix).compileMessage();
 const {lock}=developerLockAddresses({mint,creator});
 return {slot:100,blockTime:time,transaction:{signatures:[signature],message},meta:{err:null,logMessages:eventLogs(),
  preBalances:message.accountKeys.map(()=>0),postBalances:message.accountKeys.map(()=>1),
  postTokenBalances:[{mint,owner:creator,uiTokenAmount:{amount:'0'}},{mint,owner:lock.toBase58(),uiTokenAmount:{amount:'1'}}]}};
}
