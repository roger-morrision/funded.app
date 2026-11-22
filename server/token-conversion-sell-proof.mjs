import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {decodeTokenConversionV3,decodeSolCreditV3,deriveSolCreditV3,deriveTokenConversionV3} from '../mint-router-v3-token.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {finalizedProgramContext} from './finalized-program-context.mjs';
import {buildReviewedUsdcSellConversion} from './token-conversion-sell.mjs';

const address=value=>typeof value==='string'?value:value?.pubkey?.toBase58?.()||value?.toBase58?.();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const data=ix=>typeof ix.data==='string'?Buffer.from(bs58.decode(ix.data)):Buffer.from(ix.data||[]);
const safe=value=>{assert(Number.isSafeInteger(value)&&value>=0,'Unsafe balance or slot.');return BigInt(value);};

// Transaction/account FACT parser only. Calling this with mocked inputs does not
// establish finality or network identity; the admitted RPC adapter below does so.
export function tokenSellReceiptFacts({transaction:tx,signature,receiptAccount,creditAccount,expected,minimumVaultRent}){
  const built=buildReviewedUsdcSellConversion(expected),ixExpected=built.instruction,program=String(ixExpected.programId);
  assert(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature),'Invalid signature.');
  assert(tx?.meta?.err===null&&tx.transaction?.signatures?.[0]===signature&&Number.isSafeInteger(tx.slot)&&tx.slot>0,'Successful exact transaction required.');
  const message=tx.transaction.message;
  assert(typeof message.serialize==='function'&&/^[a-f0-9]{64}$/.test(expected.messageHash)
    &&sha(message.serialize())===expected.messageHash,'Frozen signed message differs.');
  const staticKeys=message.accountKeys||message.staticAccountKeys;
  const keys=[...staticKeys,...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(address);
  assert(message.header.numRequiredSignatures===2&&keys[0]===String(expected.authority)&&keys[1]===String(expected.priceSigner),'Conversion signers differ.');
  assert(tx.transaction.signatures.length===2&&tx.transaction.signatures.every((signature,index)=>
    nacl.sign.detached.verify(message.serialize(),bs58.decode(signature),new PublicKey(keys[index]).toBytes())),
  'Conversion signatures do not authenticate the frozen message.');
  const instructions=message.instructions||message.compiledInstructions;
  const ours=instructions.map((ix,index)=>({ix,index})).filter(({ix})=>keys[ix.programIdIndex]===program);
  assert(ours.length===1,'Exactly one conversion instruction required.');
  const {ix,index}=ours[0],accounts=Array.from(ix.accounts||ix.accountKeyIndexes,i=>keys[i]);
  assert(data(ix).equals(ixExpected.data)&&accounts.length===ixExpected.keys.length
    &&accounts.every((key,i)=>key===String(ixExpected.keys[i].pubkey)),'Conversion intent or custody differs.');
  assert(receiptAccount?.owner?.equals(ixExpected.programId)&&!receiptAccount.executable
    &&creditAccount?.owner?.equals(ixExpected.programId)&&!creditAccount.executable&&creditAccount.data.length===105,'Program-owned receipt and credit required.');
  const receipt=decodeTokenConversionV3(receiptAccount.data),credit=decodeSolCreditV3(creditAccount.data),category=Number(expected.category);
  assert(receipt.conversionId===Buffer.from(expected.conversionId).toString('hex')&&receipt.mint===String(expected.mint)
    &&receipt.quoteMint===built.quoteMint&&receipt.pool===built.pool&&receipt.category===category
    &&receipt.spentQuote===BigInt(expected.amountIn)&&receipt.receivedLamports>=BigInt(expected.minSolOut)
    &&credit.mint===String(expected.mint)&&credit.credited[category]>=receipt.receivedLamports,'Immutable conversion receipt or category credit differs.');
  const inner=tx.meta.innerInstructions?.find(row=>row.index===index)?.instructions||[];
  const sells=inner.filter(row=>keys[row.programIdIndex]===String(PUMP_AMM_PROGRAM_ID));
  assert(sells.length===1&&data(sells[0]).equals(Buffer.from(expected.pumpSellInstruction.data)),'Exact Pump sell CPI required.');
  const sellAccounts=Array.from(sells[0].accounts||sells[0].accountKeyIndexes,i=>keys[i]);
  assert(sellAccounts.length===23&&sellAccounts.every((key,i)=>key===String(expected.pumpSellInstruction.keys[i].pubkey)),'Pump sell CPI custody differs.');
  const vault=String(built.vault),token=accounts[7],wsol=accounts[8];
  const closes=inner.filter(row=>keys[row.programIdIndex]===String(TOKEN_PROGRAM_ID)&&data(row).equals(Buffer.from([9])));
  assert(closes.some(row=>{const a=Array.from(row.accounts||row.accountKeyIndexes,i=>keys[i]);return a.length===3&&a[0]===wsol&&a[1]===vault&&a[2]===vault;}),'WSOL custody closure required.');
  const tokenIndex=keys.indexOf(token),vaultIndex=keys.indexOf(vault),wsolIndex=keys.indexOf(wsol);
  const pre=tx.meta.preTokenBalances?.find(row=>row.accountIndex===tokenIndex),post=tx.meta.postTokenBalances?.find(row=>row.accountIndex===tokenIndex);
  for(const balance of [pre,post])assert(balance?.mint===built.quoteMint&&balance.owner===vault
    &&balance.programId===String(TOKEN_PROGRAM_ID)&&/^(0|[1-9]\d*)$/.test(balance.uiTokenAmount?.amount),'USDC custody balance evidence required.');
  assert(BigInt(pre.uiTokenAmount.amount)-BigInt(post.uiTokenAmount.amount)===receipt.spentQuote,'Exact USDC debit differs.');
  const before=safe(tx.meta.preBalances[vaultIndex]),after=safe(tx.meta.postBalances[vaultIndex]);
  const prefund=safe(tx.meta.preBalances[wsolIndex]),rent=safe(minimumVaultRent),topup=before<rent?rent-before:0n;
  assert(rent>0n,'Verified positive vault rent required.');
  assert(tx.meta.postBalances[wsolIndex]===0&&after-before-prefund-topup===receipt.receivedLamports,'Exact SOL credit, prefund or rent accounting differs.');
  return {signature,slot:tx.slot,messageHash:expected.messageHash,programId:program,conversionId:receipt.conversionId,
    mint:receipt.mint,quoteMint:receipt.quoteMint,pool:receipt.pool,category,spentQuoteRaw:String(receipt.spentQuote),
    receivedLamports:String(receipt.receivedLamports),prefundExcludedLamports:String(prefund),rentTopupLamports:String(topup),
    transactionFactsVerified:true,signaturesVerified:true,balanceDeltaVerified:true,wsolClosed:true};
}

// No runtime admission is changed. With the committed incomplete release this
// returns null before RPC. Missing context/history/status/proof stays unresolved.
export async function loadFinalizedTokenSell({connection,signature,expected,release=reviewedMainnetManifest()}){
  try{
    const approved=reviewedMainnetManifest(release);
    assert(approved&&approved.programId===String(expected.programId),'Reviewed production context required.');
    assert(await connection.getGenesisHash()===SOLANA_GENESIS['mainnet-beta'],'Mainnet genesis differs.');
    const [tx,status]=await Promise.all([connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0}),
      connection.getSignatureStatuses([signature],{searchTransactionHistory:true})]);
    const row=status.value?.[0];assert(Number.isSafeInteger(tx?.slot)&&tx.slot>0&&Number.isSafeInteger(status.context?.slot)&&status.context.slot>=tx.slot
      &&row?.confirmationStatus==='finalized'&&row.err===null&&row.slot===tx.slot,'Finalized exact signature required.');
    const evidence=await finalizedProgramContext({connection,release:approved,transactionSlot:tx.slot});
    const minimumContextSlot=evidence.programDataContextSlot;
    const program=new PublicKey(approved.programId),receipt=deriveTokenConversionV3(program,expected.mint,expected.conversionId),credit=deriveSolCreditV3(program,expected.mint);
    const [accounts,rent]=await Promise.all([connection.getMultipleAccountsInfoAndContext([receipt,credit],{commitment:'finalized',minContextSlot:minimumContextSlot}),
      connection.getMinimumBalanceForRentExemption(0,'finalized')]);
    assert(Number.isSafeInteger(accounts.context?.slot)&&accounts.context.slot>=minimumContextSlot,'Receipt evidence predates authenticated context.');
    const facts=tokenSellReceiptFacts({transaction:tx,signature,receiptAccount:accounts.value[0],creditAccount:accounts.value[1],expected,minimumVaultRent:rent});
    return {...facts,cluster:'mainnet-beta',genesisHash:SOLANA_GENESIS['mainnet-beta'],programDataSha256:approved.programDataSha256,
      deploymentSlot:evidence.deploymentSlot,programContextSlot:evidence.programContextSlot,programDataContextSlot:evidence.programDataContextSlot,
      receiptContextSlot:accounts.context.slot,finalized:true};
  }catch{return null;}
}
