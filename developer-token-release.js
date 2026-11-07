import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {PublicKey,Transaction} from '@solana/web3.js';
import {DEVELOPER_TOKEN_LOCK_PROGRAM_ID,developerLockProgramId,developerReleaseInstruction,developerReleaseInstructions,developerLockAddresses,decodeDeveloperTokenLock} from './developer-token-lock.js';

export const developerReleaseStorageKey=(mint,creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID)=>
  `funded.developer-release.devnet:${mint}:${creator}${developerLockProgramId(programId)===DEVELOPER_TOKEN_LOCK_PROGRAM_ID?'':':'+programId}`;
export async function verifyDeveloperRelease({connection,mint,creator,receipt}){
  const programId=developerLockProgramId(receipt.programId);
  const tx=await connection.getTransaction(receipt.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!tx){
    // Finalized expiry plus absent historical status permits a fresh attempt.
    if(Number.isSafeInteger(receipt.lastValidBlockHeight)&&await connection.getBlockHeight('finalized')>receipt.lastValidBlockHeight){
      const status=(await connection.getSignatureStatuses([receipt.signature],{searchTransactionHistory:true})).value[0];
      if(status===null)return {status:'failed',signature:receipt.signature,reason:'expired-unlanded'};
    }
    return {status:'pending',signature:receipt.signature};
  }
  if(tx.transaction.signatures[0]!==receipt.signature)throw Error('Release receipt identity differs.');
  if(tx.meta?.err)return {status:'failed',signature:receipt.signature};
  const addresses=developerLockAddresses({mint,creator,programId});
  const expected=developerReleaseInstruction({mint,creator,programId}).instruction,message=tx.transaction.message;
  const keys=[...(message.accountKeys||message.staticAccountKeys||[]),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(k=>k.toBase58());
  const matches=(message.instructions||message.compiledInstructions||[]).filter(ix=>keys[ix.programIdIndex]===expected.programId.toBase58()
    &&Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data).equals(expected.data)
    &&JSON.stringify(Array.from(ix.accounts||ix.accountKeyIndexes||[],i=>keys[i]))===JSON.stringify(expected.keys.map(k=>k.pubkey.toBase58())));
  if(matches.length!==1)throw Error('Expected escrow release instruction is missing.');
  const state=decodeDeveloperTokenLock(await connection.getAccountInfo(addresses.lock,'finalized'),{mint,creator,programId});
  if(!state.releasedAt||state.amount!==String(receipt.amount))throw Error('Released escrow state does not match the receipt.');
  const tokenTotal=(rows,owner)=>rows.filter(r=>r.mint===mint&&r.owner===owner).reduce((n,r)=>n+BigInt(r.uiTokenAmount.amount),0n);
  const before=tx.meta.preTokenBalances||[],after=tx.meta.postTokenBalances||[],amount=BigInt(receipt.amount);
  if(tokenTotal(before,addresses.lock.toBase58())-tokenTotal(after,addresses.lock.toBase58())!==amount
    ||tokenTotal(after,creator)-tokenTotal(before,creator)!==amount)throw Error('Release token balance changes are not verified.');
  return {status:'finalized',signature:receipt.signature,amount:receipt.amount};
}
export async function releaseDeveloperTokens({connection,provider,mint,creator,amount,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID,assertCurrent=()=>{},storage=globalThis.localStorage}){
  programId=developerLockProgramId(programId);
  if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Token release requires Devnet.');
  const key=developerReleaseStorageKey(mint,creator,programId),pending=storage.getItem(key);
  if(pending){
    const receipt=JSON.parse(pending);
    if(receipt.mint!==mint||receipt.creator!==creator||developerLockProgramId(receipt.programId)!==programId)throw Error('Saved release identity differs.');
    const result=await verifyDeveloperRelease({connection,mint,creator,receipt});
    if(result.status!=='pending')storage.removeItem(key);
    return result;
  }
  if(provider.publicKey?.toBase58()!==creator||typeof provider.signTransaction!=='function')throw Error('Connect the original developer wallet.');
  const latest=await connection.getLatestBlockhash('finalized');
  const transaction=new Transaction({feePayer:new PublicKey(creator),recentBlockhash:latest.blockhash})
    .add(...developerReleaseInstructions({mint,creator,programId}));
  const message=Buffer.from(transaction.serializeMessage());assertCurrent();
  const signed=await provider.signTransaction(transaction);assertCurrent();
  if(!(signed instanceof Transaction)||!Buffer.from(signed.serializeMessage()).equals(message))throw Error('Wallet changed the reviewed token release. Nothing was sent.');
  const raw=signed.serialize(),signature=bs58.encode(signed.signature);
  const receipt={mint,creator,programId,amount:String(amount),signature,lastValidBlockHeight:latest.lastValidBlockHeight};
  storage.setItem(key,JSON.stringify(receipt)); // Persist public receipt identity before broadcast.
  try{const returned=await connection.sendRawTransaction(raw,{skipPreflight:false});if(returned!==signature)throw Error('Release signature differs.');
    await connection.confirmTransaction({signature,...latest},'finalized');}catch{/* Reconcile the exact signed transaction, never replace an uncertain send. */}
  const result=await verifyDeveloperRelease({connection,mint,creator,receipt});
  if(result.status!=='pending')storage.removeItem(key);
  return result;
}
