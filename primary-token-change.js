import {PublicKey,Transaction,VersionedTransaction} from '@solana/web3.js';
import {CONFIGURED_DEVNET_PROGRAM,configuredDevnetProgram} from './configured-devnet-program.js';
import {assertRpcNetwork} from './solana-network.js';
import {readRichAssets,buildConfigureRichAssets} from './rich-assets.js';

export async function verifyPrimaryTokenRelease(connection,cluster,programId){
  const release=configuredDevnetProgram(cluster,programId);
  if(!release)throw Error('Primary-token changes are available only on the configured Devnet program.');
  await assertRpcNetwork(connection,cluster);
  const program=new PublicKey(programId),loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const dataAddress=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const [account,data]=await connection.getMultipleAccountsInfo([program,dataAddress],'finalized');
  if(!account?.executable||!account.owner.equals(loader)||account.data.length!==36||account.data.readUInt32LE(0)!==2
    ||!new PublicKey(account.data.subarray(4)).equals(dataAddress)||!data?.owner.equals(loader))throw Error('The approved program could not be verified.');
  const digest=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',data.data)),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==release.programDataSha256)throw Error('Program code changed. A reviewed application update is required.');
  return release;
}

export async function preparePrimaryTokenChange({connection,cluster,programId,owner,mint,market,venue,revision,
  verifyRelease=verifyPrimaryTokenRelease}){
  await verifyRelease(connection,cluster,programId);
  const current=await readRichAssets(connection,programId);
  if(String(current.authority)!==String(owner))throw Error('Connect the current primary-token administrator wallet.');
  if(current.revision!==String(revision))throw Error('Configuration changed. Refresh and review the new revision.');
  const nextRevision=String(BigInt(current.revision)+1n);
  const latest=await connection.getLatestBlockhash('finalized');
  const transaction=new Transaction({...latest,feePayer:new PublicKey(owner)}).add(buildConfigureRichAssets({programId,owner,mint,market,venue,nextRevision}));
  const simulation=await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()),{sigVerify:false,commitment:'finalized'});
  if(simulation.value.err)throw Error('The program rejected this token and market. Check that they match and use a supported SOL market.');
  const [fee,rent,balance]=await Promise.all([connection.getFeeForMessage(transaction.compileMessage(),'confirmed'),
    connection.getMinimumBalanceForRentExemption(177),connection.getBalance(new PublicKey(owner),'confirmed')]);
  if(!Number.isSafeInteger(fee.value)||fee.value<0||fee.value>1_000_000||!Number.isSafeInteger(rent)||balance<fee.value+rent)
    throw Error('The wallet needs enough Devnet SOL for the configuration account and a bounded network fee.');
  return{transaction,latest,nextRevision,estimatedLamports:fee.value+rent,
    expected:{programId,mint:String(new PublicKey(mint)),market:String(new PublicKey(market)),venue,revision:nextRevision,authority:String(owner)}};
}

export async function confirmPrimaryTokenChange(connection,pending){
  const status=(await connection.getSignatureStatuses([pending.signature],{searchTransactionHistory:true})).value[0];
  if(status?.err)throw Error('The transaction failed on-chain. Refresh the configuration before trying again.');
  if(status?.confirmationStatus!=='finalized')return null;
  await verifyPrimaryTokenRelease(connection,'devnet',pending.programId);
  const saved=await readRichAssets(connection,pending.programId,{revision:pending.revision});
  if(String(saved.mint)!==pending.mint||String(saved.pool)!==pending.market||saved.venue!==pending.venue||String(saved.authority)!==pending.authority)
    throw Error('The finalized revision differs from the reviewed change.');
  return{...pending,slot:status.slot,status:'finalized'};
}

export const PRIMARY_TOKEN_PROGRAM_ID=CONFIGURED_DEVNET_PROGRAM.programId;
