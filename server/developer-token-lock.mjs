import {PublicKey} from '@solana/web3.js';
import {PUMP_PROGRAM_ID,bondingCurvePda} from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import {readProgramDataEvidence,DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';
import {successfulEventLogs} from './product-trade-index.mjs';
import {decodePumpTrades} from './coin-market.mjs';
import {completeFinalizedEventReceipt} from './finalized-event-receipt.mjs';
import {DEVELOPER_TOKEN_LOCK_PROGRAM_ID,DEVELOPER_TOKEN_LOCK_SECONDS,developerLockProgramId,DEVELOPER_TOKEN_LOCK_PROGRAMS,developerLockAddresses,developerLockInstruction,decodeDeveloperTokenLock} from '../developer-token-lock.js';

export async function developerLockConfig({connection,env=process.env,programId:requested,readEvidence=readProgramDataEvidence}) {
  const active=developerLockProgramId(env.FUNDED_DEVELOPER_LOCK_PROGRAM_ID||DEVELOPER_TOKEN_LOCK_PROGRAM_ID);
  const programId=developerLockProgramId(requested||active);
  const legacy=programId===DEVELOPER_TOKEN_LOCK_PROGRAM_ID&&active!==programId;
  const hash=String(legacy?env.FUNDED_DEVELOPER_LOCK_LEGACY_PROGRAM_DATA_SHA256||'':env.FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256||'');
  if(!legacy&&programId!==active||programId!==DEVELOPER_TOKEN_LOCK_PROGRAM_ID
    &&(programId!==env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID||hash!==env.FUNDED_V3_PROGRAM_DATA_SHA256))
    return {ready:false,programId,lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS,reason:'Merged escrow must match the approved router deployment.'};
  if(!/^[a-f0-9]{64}$/.test(hash))return {ready:false,programId,lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS,reason:'Developer token escrow deployment is not configured.'};
  try {
    const [genesis,evidence]=await Promise.all([connection.getGenesisHash(),readEvidence(connection,new PublicKey(programId))]);
    const ready=genesis===DEVNET_GENESIS_HASH&&evidence.account?.executable===true&&evidence.sha256===hash;
    return {ready,programId,programDataSha256:hash,lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS,
      ...(!ready?{reason:'Developer token escrow deployment could not be verified.'}:{})};
  }catch{return {ready:false,programId,lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS,reason:'Developer token escrow deployment verification is unavailable.'};}
}

// Recover a launch signed just before cutover using its original pinned escrow.
export function developerLockProgramFromTransaction(transaction) {
  const message=transaction.transaction.message;
  const keys=[...(message.accountKeys||message.staticAccountKeys||[]),...(transaction.meta?.loadedAddresses?.writable||[]),...(transaction.meta?.loadedAddresses?.readonly||[])].map(k=>new PublicKey(k.pubkey||k).toBase58());
  const matches=(message.instructions||message.compiledInstructions||[]).filter(ix=>{
    const data=Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data);
    return DEVELOPER_TOKEN_LOCK_PROGRAMS.includes(keys[ix.programIdIndex])&&data.subarray(0,8).equals(Buffer.from('7997ce5b503ff839','hex'));
  });
  if(matches.length>1)throw Error('Ambiguous developer escrow instructions.');
  return matches.length?keys[matches[0].programIdIndex]:undefined;
}

export async function verifyLaunchDeveloperLock({connection,proof,reserve,transaction,config,serviceQuote}) {
  if(!config?.ready)throw Error('The approved developer token escrow is unavailable.');
  if(!transaction||transaction.meta?.err!==null||transaction.transaction?.signatures?.[0]!==proof.signature||transaction.slot!==proof.slot)
    throw Error('A finalized launch transaction is required for developer-token verification.');
  transaction=await completeFinalizedEventReceipt({connection,transaction,signature:proof.signature});
  const mint=new PublicKey(proof.mint),creator=proof.feePayer;
  const trades=successfulEventLogs(transaction.meta.logMessages).filter(e=>e.program===PUMP_PROGRAM_ID.toBase58())
    .flatMap(e=>decodePumpTrades([e.log],mint));
  if(!trades.length||trades.some(t=>!t.isBuy||t.trader!==creator))throw Error('Launch trades contain an unexpected buyer or sale.');
  const purchased=trades.reduce((sum,t)=>sum+t.tokenAmountRaw,0n),reserved=BigInt(reserve.fundedTokens)*1_000_000n;
  const amount=purchased-reserved;
  if(amount<0n||amount>200_000_000n*1_000_000n)throw Error('Developer allocation exceeds its verified 20% limit.');
  const programId=developerLockProgramId(config.programId),addresses=developerLockAddresses({mint,creator,programId});
  const allowed=new Set([creator,reserve.vault,addresses.lock.toBase58(),bondingCurvePda(mint).toBase58()]);
  const balances=transaction.meta.postTokenBalances?.filter(b=>b.mint===proof.mint);
  if(!balances?.length||balances.some(b=>!allowed.has(b.owner)&&BigInt(b.uiTokenAmount.amount)>0n)
    ||balances.some(b=>b.owner===creator&&BigInt(b.uiTokenAmount.amount)!==0n))
    throw Error('The declared developer allocation must be escrowed atomically; unexpected launch token recipients were found.');
  if(amount===0n)return {version:1,status:'not-selected',verified:true,amount:'0',lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS};
  const expected=developerLockInstruction({mint,creator,amount,quoteId:serviceQuote?.id,programId}).instruction;
  const message=transaction.transaction.message;
  const keys=[...(message.accountKeys||message.staticAccountKeys||[]),...(transaction.meta.loadedAddresses?.writable||[]),...(transaction.meta.loadedAddresses?.readonly||[])].map(k=>k.toBase58());
  const instructions=message.instructions||message.compiledInstructions||[];
  const matches=instructions.filter(ix=>keys[ix.programIdIndex]===config.programId
    &&Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data).equals(expected.data)
    &&JSON.stringify(Array.from(ix.accounts||ix.accountKeyIndexes,i=>keys[i]))===JSON.stringify(expected.keys.map(k=>k.pubkey.toBase58())));
  if(matches.length!==1||!balances.some(b=>b.owner===addresses.lock.toBase58()&&BigInt(b.uiTokenAmount.amount)===amount))
    throw Error('The exact developer escrow instruction and token balance are missing from the launch transaction.');
  const index=keys.indexOf(addresses.lock.toBase58());
  if(index<0||transaction.meta.preBalances[index]!==0||transaction.meta.postBalances[index]<=0)throw Error('Developer escrow must be initialized in the launch transaction.');
  const saved=decodeDeveloperTokenLock(await connection.getAccountInfo(addresses.lock,'finalized'),{mint,creator,programId});
  if(saved.amount!==String(amount)||saved.lockedAt!==proof.createdTimestamp)throw Error('Developer escrow does not match the verified launch allocation and time.');
  return {...saved,version:1,status:'funded',verified:true,programId:config.programId,programDataSha256:config.programDataSha256,
    vault:addresses.vault.toBase58(),fundingSignature:proof.signature,atomicWithLaunch:true,lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS};
}
