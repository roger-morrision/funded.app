import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,unpackAccount,createAssociatedTokenAccountIdempotentInstruction,NATIVE_MINT} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {SOLANA_GENESIS} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {deriveFeeRouter,verifyFeeRouterAccount} from '../fee-router.js';
import {deriveAgencyPolicyV3,decodeAgencyPolicyV3,agencyCategoryTargets} from '../agency-mint-router-v3.js';
import {deriveTokenLedgerV3,deriveTokenConversionV3,deriveSolCreditV3,decodeTokenLedgerV3,decodeSolCreditV3} from '../mint-router-v3-token.js';
import {priceConfigAddress} from './buyback-price-signer.mjs';
import {finalizedProgramContext} from './finalized-program-context.mjs';
import {validateComputeInstructions} from './price-signer-review.mjs';
import {verifyV3BuybackAuthorityReserve} from './v3-buyback-setup.mjs';
import {buildReviewedUsdcSellConversion,decodeTokenConversionIntent} from './token-conversion-sell.mjs';
import {independentTokenSellQuote,requireTokenSellPolicy} from './token-conversion-sell-quote.mjs';
import {verifyTokenSellSimulation} from './token-conversion-sell-simulation.mjs';
import {encodeTokenSellIntent} from './token-conversion-intent.mjs';

const key=value=>new PublicKey(value),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const tokenPricePolicyHash=value=>sha(JSON.stringify(canonical(value)));
const disc=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);

export function requireReviewedTokenSignerPolicy(config,release){
  const approved=reviewedMainnetManifest(release);
  assert(approved&&config.cluster==='mainnet-beta'&&config.programId===approved.programId
    &&config.programDataSha256===approved.programDataSha256&&config.upgradeAuthority===approved.upgradeAuthority,'Reviewed production conversion context required.');
  assert(approved.priceSignerPolicy&&tokenPricePolicyHash(config)===tokenPricePolicyHash(approved.priceSignerPolicy)
    &&tokenPricePolicyHash(config)===approved.independentReview.priceSignerPolicySha256,'Independent conversion signer policy review required.');
  requireTokenSellPolicy(config.quotePolicy);
  assert(new Set([config.authority,config.priceSigner,config.upgradeAuthority]).size===3,'Operator, price and upgrade roles must differ.');
  return approved;
}

export function tokenSellFeeSetup({swap,authority}){
  const seen=new Set();return [[9,10],[18,17],[21,22]].flatMap(([ownerIndex,ataIndex])=>{
    const ata=swap.keys[ataIndex].pubkey,id=String(ata);if(seen.has(id))return [];seen.add(id);
    return [createAssociatedTokenAccountIdempotentInstruction(key(authority),ata,swap.keys[ownerIndex].pubkey,NATIVE_MINT,TOKEN_PROGRAM_ID)];
  });
}

// Read-only review core; NOT wired into HTTP signing or worker admission.
// Public release evidence must explicitly bind roles and typed quote policy.
export async function reviewTokenSellConversion({connection,config,signer,request,now=Date.now(),release=reviewedMainnetManifest()}){
  config=structuredClone(config);request=structuredClone(request);release=structuredClone(release);
  const started=Date.now(),approved=requireReviewedTokenSignerPolicy(config,release);
  const program=key(config.programId),authority=key(config.authority),price=key(String(signer));
  assert(config.priceSigner===String(price)&&new Set([String(authority),String(price),config.upgradeAuthority]).size===3,'Operator, price and upgrade roles must differ.');
  assert(request?.cluster==='mainnet-beta'&&request.programId===config.programId&&typeof request.transaction==='string'&&request.transaction.length<=1644,'Unapproved conversion request.');
  const raw=Buffer.from(request.transaction,'base64');assert(raw.length<=1232&&raw.toString('base64')===request.transaction,'Invalid conversion encoding.');
  const transaction=VersionedTransaction.deserialize(raw),message=transaction.message;
  assert(message.version===0&&message.header.numRequiredSignatures===2&&message.staticAccountKeys[0].equals(authority)
    &&message.staticAccountKeys[1].equals(price)&&transaction.signatures.every(s=>s.every(byte=>byte===0)),'Only exact unsigned operator/price transactions may be reviewed.');
  assert(await connection.getGenesisHash()===SOLANA_GENESIS['mainnet-beta'],'Conversion RPC genesis differs.');
  const contextFloor=await connection.getSlot('finalized');
  await finalizedProgramContext({connection,release:approved,transactionSlot:contextFloor});
  assert((await connection.isBlockhashValid(message.recentBlockhash,'finalized')).value,'Conversion blockhash expired.');
  assert(message.addressTableLookups.length<=2,'Too many conversion lookup tables.');
  const tables=[];for(const lookup of message.addressTableLookups){const table=(await connection.getAddressLookupTable(lookup.accountKey,{commitment:'finalized'})).value;assert(table?.isActive(),'Conversion lookup table unavailable.');tables.push(table);}
  const instructions=TransactionMessage.decompile(message,{addressLookupTableAccounts:tables}).instructions,ix=instructions.at(-1);
  assert(ix?.programId.equals(program)&&ix.keys.length===41,'Exact final conversion instruction required.');
  const intent=decodeTokenConversionIntent(Buffer.from(ix.data)),coin=ix.keys[1].pubkey,category=intent.category;
  const market=await independentTokenSellQuote({connection,amountIn:intent.amountIn,policy:config.quotePolicy,now});
  assert(BigInt(intent.minSolOut)>=BigInt(market.minimumLamports),'Independent conversion output protection is too low.');
  const swapData=Buffer.alloc(24);Buffer.from('33e685a4017f83ad','hex').copy(swapData);swapData.writeBigUInt64LE(BigInt(intent.amountIn),8);swapData.writeBigUInt64LE(BigInt(intent.minSolOut),16);
  const writable=new Set([0,1,5,6,7,8,10,17,22]);
  const swap=new TransactionInstruction({programId:PUMP_AMM_PROGRAM_ID,data:swapData,
    keys:ix.keys.slice(16,39).map((k,index)=>({pubkey:k.pubkey,isSigner:index===1,isWritable:writable.has(index)}))});
  const built=buildReviewedUsdcSellConversion({programId:program,mint:coin,authority,priceSigner:price,conversionId:Buffer.from(intent.conversionId,'hex'),
    category,amountIn:intent.amountIn,minSolOut:intent.minSolOut,pumpSellInstruction:swap,...market});
  const policyAddress=deriveAgencyPolicyV3(program,coin).address,ledgerAddress=deriveTokenLedgerV3(program,coin,market.quoteMint),
    receipt=deriveTokenConversionV3(program,coin,Buffer.from(intent.conversionId,'hex')),creditAddress=deriveSolCreditV3(program,coin);
  const addresses=[built.vault,built.instruction.keys[7].pubkey,built.instruction.keys[8].pubkey,receipt,creditAddress,ledgerAddress,policyAddress,priceConfigAddress(program)];
  const before=await connection.getMultipleAccountsInfoAndContext(addresses,{commitment:'finalized',minContextSlot:market.slot});
  assert(before.context.slot>=market.slot,'Conversion accounting snapshot moved backwards.');
  const [vaultInfo,tokenInfo,wsolInfo,receiptInfo,creditInfo,ledgerInfo,policyInfo,priceInfo]=before.value;
  assert(!receiptInfo,'Conversion receipt already exists; replay rejected.');
  assert(priceInfo?.owner.equals(program)&&priceInfo.data.length===40&&priceInfo.data.subarray(0,8).equals(disc('BuybackPriceConfig'))
    &&priceInfo.data.subarray(8).equals(price.toBuffer()),'Conversion price signer is not activated.');
  const router=await verifyFeeRouterAccount({connection,programId:program,commitment:'finalized'});
  assert(router.verified&&router.guard&&!router.guard.paused&&router.authority.equals(authority),'Current Mainnet operator/guard differs.');
  assert(vaultInfo?.owner.equals(SystemProgram.programId)&&vaultInfo.data.length===0&&tokenInfo?.owner.equals(TOKEN_PROGRAM_ID)
    &&ledgerInfo?.owner.equals(program)&&policyInfo?.owner.equals(program),'Conversion custody/accounting ownership differs.');
  const token=unpackAccount(addresses[1],tokenInfo,TOKEN_PROGRAM_ID),ledger=decodeTokenLedgerV3(ledgerInfo.data);
  assert(token.owner.equals(built.vault)&&token.mint.toBase58()===market.quoteMint&&!token.isFrozen&&token.amount>=BigInt(intent.amountIn)
    &&ledger.mint===String(coin)&&ledger.quoteMint===market.quoteMint&&ledger.paid[category]-ledger.withdrawn[category]>=BigInt(intent.amountIn),'Conversion exceeds category custody or budget.');
  if(creditInfo)assert(creditInfo.owner.equals(program)&&creditInfo.data.length===105&&decodeSolCreditV3(creditInfo.data).mint===String(coin),'Conversion credit context differs.');
  const policy=decodeAgencyPolicyV3(policyInfo,{programId:program,mint:coin,creator:key(policyInfo.data.subarray(40,72)),initialAuthority:key(policyInfo.data.subarray(72,104)),
    credited:creditInfo?decodeSolCreditV3(creditInfo.data).credited:null});
  const targets=agencyCategoryTargets(ledger.settled,policy.protocolUnits);
  let prefix=0n,previous=0n;const directed=policy.directedUnits.map(n=>{prefix+=BigInt(n);const boundary=ledger.paid[0]*prefix/8000000n,share=boundary-previous;previous=boundary;return share;});
  assert(ledger.paid.every((n,i)=>n===targets[i])&&ledger.withdrawn.every((n,i)=>n<=ledger.paid[i])
    &&ledger.released.every((n,i)=>n<=directed[i])&&ledger.released.reduce((sum,n)=>sum+n,0n)===ledger.withdrawn[0],'Paired category allocation/release accounting differs.');
  if(wsolInfo){
    assert(wsolInfo.owner.equals(TOKEN_PROGRAM_ID)||wsolInfo.owner.equals(SystemProgram.programId)&&wsolInfo.data.length===0,'WSOL prefund owner differs.');
    if(wsolInfo.owner.equals(TOKEN_PROGRAM_ID)){
      const wsol=unpackAccount(addresses[2],wsolInfo,TOKEN_PROGRAM_ID);
      assert(wsol.mint.equals(NATIVE_MINT)&&wsol.owner.equals(built.vault)&&wsol.isNative&&!wsol.isFrozen,'WSOL prefund token custody differs.');
    }
  }
  const setup=tokenSellFeeSetup({swap,authority}),compute=instructions.slice(0,-1).filter(ix=>ix.programId.equals(ComputeBudgetProgram.programId));
  validateComputeInstructions(compute);for(const ix of compute)if(ix.data[0]===3)assert(ix.data.readBigUInt64LE(1)===0n,'Unapproved conversion priority fee.');
  const canonical=new TransactionMessage({payerKey:authority,recentBlockhash:message.recentBlockhash,instructions:[...compute,...setup,built.instruction]}).compileToV0Message(tables);
  assert(Buffer.from(canonical.serialize()).equals(Buffer.from(message.serialize())),'Noncanonical conversion setup, accounts or flags.');
  assert((await verifyV3BuybackAuthorityReserve({connection,transaction,authority,priceSigner:price,setupCount:setup.length})).ready,'Protected operator reserve is insufficient.');
  const vaultRent=await connection.getMinimumBalanceForRentExemption(0,'finalized');built.wsolPrefundLamports=wsolInfo?.lamports||0;
  const simulation=await connection.simulateTransaction(transaction,{sigVerify:false,replaceRecentBlockhash:true,commitment:'finalized',minContextSlot:before.context.slot,
    accounts:{encoding:'base64',addresses:addresses.slice(0,7).map(String)}});
  const result=verifyTokenSellSimulation({simulation,program,built,beforeVault:vaultInfo,beforeToken:token,ledgerInfo,policyInfo,creditInfo,
    amountIn:intent.amountIn,minSolOut:intent.minSolOut,category,vaultRent,minimumContextSlot:before.context.slot});
  const finalContext=await finalizedProgramContext({connection,release:approved,transactionSlot:simulation.context.slot});
  assert(Date.now()-started<35000,'Conversion review expired.');
  const messageHash=sha(message.serialize()),proofIntent=encodeTokenSellIntent({programId:program,mint:coin,authority,priceSigner:price,
    conversionId:Buffer.from(intent.conversionId,'hex'),category,amountIn:intent.amountIn,minSolOut:intent.minSolOut,pumpSellInstruction:swap,...market,messageHash});
  return {transaction,messageHash,proofIntent,programId:config.programId,programDataSha256:config.programDataSha256,
    genesisHash:SOLANA_GENESIS['mainnet-beta'],policyHash:tokenPricePolicyHash(config),vault:String(built.vault),receipt:String(receipt),
    budgetAsset:market.quoteMint,conversionId:intent.conversionId,category,amountIn:intent.amountIn,minSolOut:intent.minSolOut,
    reviewedAt:now,blockhash:message.recentBlockhash,slot:before.context.slot,programContextSlot:finalContext.programContextSlot,
    programDataContextSlot:finalContext.programDataContextSlot,...result,scope:'read-only conversion review'};
}
