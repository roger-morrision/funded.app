import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {deriveFeeRouter,verifyFeeRouterAccount} from '../fee-router.js';
import {deriveMintPolicyV3,deriveMintVaultsV3,verifyMintPolicyV3Account} from '../mint-router-v3.js';
import {deriveAgencyPolicyV3,deriveAgencyVaultsV3,decodeAgencyPolicyV3,agencyDiscriminator,readSolCreditLamportsV3} from '../agency-mint-router-v3.js';
import {canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {priceConfigAddress,priceSignerActivated} from './buyback-price-signer.mjs';
import {v3BuybackFeeSetup,verifyV3BuybackAuthorityReserve} from './v3-buyback-setup.mjs';
import {independentMarketQuote} from './price-signer-market.mjs';
import {bondingCurvePda,PUMP_PROGRAM_ID} from './v3-buyback-curve.mjs';
import {priceReviewNetwork} from './price-review-network.mjs';

const key=x=>new PublicKey(x),hash=x=>createHash('sha256').update(x).digest('hex');
const loader=key('BPFLoaderUpgradeab1e11111111111111111111111');
const disc=name=>createHash('sha256').update(name).digest().subarray(0,8);
export const PRICE_SIGNER_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export function decodeBuybackRequest(data){
  const agency=data.length===122&&data.subarray(0,8).equals(agencyDiscriminator('buyback_agency_mint_v3'));
  assert(agency||data.length===64&&data.subarray(0,8).equals(disc('global:buyback_mint_v3')),'Only RICH buy-and-burn instructions are permitted.');
  // Category 6 / agent 255 buys and burns RICH; category 7 / agent 1|2 buys and
  // burns the launch's own coin at a market-cap milestone.
  const ownCoin=agency&&data[40]===7&&(data[41]===1||data[41]===2);
  if(agency)assert(ownCoin||data[40]===6&&data[41]===255&&data.subarray(42,98).equals(Buffer.alloc(56)),'Unsupported agency buyback category.');
  const offset=agency?98:40,quote=data.readBigUInt64LE(offset),minimum=data.readBigUInt64LE(offset+8),limit=data.readBigUInt64LE(offset+16);
  assert(quote>=10000n&&minimum>0n&&limit===quote,'A positive, bounded purchase is required.');
  const observation=ownCoin?{slot:data.readBigUInt64LE(42),observedAt:data.readBigInt64LE(50),
    marketCapUsdMicros:data.readBigUInt64LE(58),hash:data.subarray(66,98)}:null;
  if(ownCoin)assert(observation.slot>0n&&observation.observedAt>0n&&observation.marketCapUsdMicros>0n
    &&!observation.hash.equals(Buffer.alloc(32)),'A complete own-coin observation is required.');
  return{agency,ownCoin,agent:ownCoin?data[41]:null,observation,id:data.subarray(8,40),quote,minimum,limit};
}

export function validateComputeInstructions(instructions){
  let units=200000,price=0n,seen=new Set();
  for(const ix of instructions){
    assert(ix.programId.equals(ComputeBudgetProgram.programId)&&ix.keys.length===0,'Only compute settings may precede setup.');
    const data=Buffer.from(ix.data),type=data[0];
    assert(!seen.has(type),'Duplicate compute instruction.');seen.add(type);
    if(type===2&&data.length===5){units=data.readUInt32LE(1);assert(units>=1&&units<=1400000,'Compute limit exceeded.');}
    else if(type===3&&data.length===9)price=data.readBigUInt64LE(1);
    else throw Error('Unsupported compute instruction.');
  }
  assert((BigInt(units)*price+999999n)/1000000n<=10000n,'Priority fee limit exceeded.');
}

export async function verifiedProgram(connection,config){
  const program=key(config.programId),dataKey=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const [programInfo,data]=await connection.getMultipleAccountsInfo([program,dataKey],'finalized');
  assert(programInfo?.executable&&programInfo.owner.equals(loader)&&programInfo.data.length===36
    &&programInfo.data.readUInt32LE(0)===2&&programInfo.data.subarray(4).equals(dataKey.toBuffer()),'Program loader identity differs.');
  assert(data?.owner.equals(loader)&&data.data.readUInt32LE(0)===3&&data.data[12]===1
    &&data.data.subarray(13,45).equals(key(config.upgradeAuthority).toBuffer())
    &&hash(data.data)===config.programDataSha256,'Deployed program or upgrade authority differs from the signer allowlist.');
}

export async function reviewBuyback({connection,config,signer,request,marketQuote=independentMarketQuote,now=Date.now()}){
  const started=Date.now(),program=key(config.programId),authority=key(config.authority);
  const network=priceReviewNetwork(config,request);
  assert(typeof request.transaction==='string'&&request.transaction.length<=1644,'Invalid transaction size.');
  const raw=Buffer.from(request.transaction,'base64');
  assert(raw.length<=1232&&raw.toString('base64')===request.transaction,'Invalid transaction encoding.');
  const transaction=VersionedTransaction.deserialize(raw),message=transaction.message;
  assert(message.version===0&&message.header.numRequiredSignatures===2&&message.staticAccountKeys[0].equals(authority)
    &&message.staticAccountKeys[1].equals(signer)&&!signer.equals(authority),'Unapproved signing authorities.');
  assert(transaction.signatures.every(s=>s.every(b=>b===0)),'Only unsigned transactions may be reviewed.');
  assert(await connection.getGenesisHash()===network.genesisHash,'Price review RPC does not match the approved network.');
  await verifiedProgram(connection,config);
  assert(await priceSignerActivated(connection,program,signer),'Price signer is not activated.');
  const slot=await connection.getSlot('finalized'),time=await connection.getBlockTime(slot);
  assert(Number.isSafeInteger(time)&&Math.abs(now/1000-time)<=90,'Finalized RPC data is stale.');
  assert((await connection.isBlockhashValid(message.recentBlockhash,'confirmed')).value,'Blockhash has expired.');
  const tables=[];
  for(const lookup of message.addressTableLookups){
    const result=await connection.getAddressLookupTable(lookup.accountKey,{commitment:'finalized'});
    assert(result.value&&result.value.isActive(),'Lookup table is unavailable.');tables.push(result.value);
  }
  const decoded=TransactionMessage.decompile(message,{addressLookupTableAccounts:tables}),ixs=decoded.instructions;
  assert(ixs.length>=1&&ixs.length<=6,'Unexpected instruction count.');
  const ix=ixs.at(-1);assert(ix.programId.equals(program),'Buyback must be the last instruction.');
  const args=decodeBuybackRequest(Buffer.from(ix.data));
  assert(args.quote<=BigInt(config.maxOrderLamports),'Order exceeds signer spend limit.');
  assert(ix.keys.length>=36&&ix.keys.length<=45,'Unexpected buyback accounts.');
  assert(!args.ownCoin||config.allowOwnCoin===true,'Own-coin agency signing is not enabled.');
  const creator=ix.keys[1].pubkey,sourceMint=ix.keys[2].pubkey;
  const vault=args.ownCoin?deriveAgencyVaultsV3(program,sourceMint)[7]:deriveMintVaultsV3(program,sourceMint)[6];
  // Own-coin buys purchase the launch mint from its canonical SOL pool only.
  const target=args.ownCoin?{...config,mint:String(sourceMint),pool:String(canonicalPumpPoolPda(sourceMint,NATIVE_MINT)),allowCurve:false,ownCoin:true}:config;
  const policyKey=(args.agency?deriveAgencyPolicyV3:deriveMintPolicyV3)(program,sourceMint).address;
  const receipt=PublicKey.findProgramAddressSync([Buffer.from('mint-buyback-v3'),sourceMint.toBuffer(),args.id],program)[0];
  const [policyInfo,vaultInfo,receiptInfo,mintInfo]=await connection.getMultipleAccountsInfo([policyKey,vault,receipt,key(target.mint)],'finalized');
  assert(policyInfo?.owner.equals(program)&&policyInfo.data.length>=104,'Fee policy is unavailable.');
  const initialAuthority=key(policyInfo.data.subarray(72,104));
  const policy=args.agency?decodeAgencyPolicyV3(policyInfo,{programId:program,mint:sourceMint,creator,initialAuthority,credited:await readSolCreditLamportsV3(connection,program,sourceMint)}):
    await verifyMintPolicyV3Account({connection,programId:program,mint:sourceMint,creator,initialAuthority});
  const router=await verifyFeeRouterAccount({connection,programId:program,commitment:'finalized'});
  assert(router.verified&&router.authority.equals(authority),'Current router authority differs.');
  assert(policy.verified&&policy.protocolUnits[5]===500000,'Unapproved fee allocation.');
  const category=args.ownCoin?7:6,rent=await connection.getMinimumBalanceForRentExemption(0,'finalized');
  assert(!receiptInfo,'Receipt already exists; replay rejected.');
  assert(vaultInfo?.owner.equals(SystemProgram.programId)&&vaultInfo.data.length===0,'Fee-vault custody differs.');
  if(args.ownCoin){
    const bit=1<<args.agent,left=policy.agentTargets[args.agent]-policy.agentSpent[args.agent];
    assert(policy.selectedMask&bit&&!(policy.completedMask&bit)&&left>=args.limit
      &&BigInt(vaultInfo.lamports)-BigInt(rent)>=args.limit,'Own-coin agent budget or milestone state differs.');
  }else{
    const remaining=policy.paidLamports[6]-policy.withdrawnLamports[6];
    assert(BigInt(vaultInfo.lamports)===BigInt(rent)+remaining&&remaining>=args.limit,'Fee-vault custody or available budget differs.');
  }
  const quote=await marketQuote({connection,config:target,vault,quote:args.quote});
  assert(BigInt(quote.spendableQuoteIn)===args.quote&&args.minimum>=BigInt(quote.minBaseAmountOut),'Quote exceeds liquidity limit or output protection is too low.');
  if(args.ownCoin){
    // The authority's observation only matters on-chain; the signer requires
    // its own reading to clear the milestone and to agree within 10%.
    const threshold=BigInt(policy.rules.marketCapUsd[args.agent-1])*1000000n,own=BigInt(quote.marketCapUsdMicros??-1),seen=args.observation.marketCapUsdMicros;
    const age=BigInt(Math.floor(now/1000))-args.observation.observedAt;
    assert(!quote.curve&&own>=threshold&&seen>=threshold&&age>=-5n&&age<=60n
      &&(own>seen?own-seen:seen-own)*10n<=own,'Independent market cap does not confirm the milestone.');
  }
  assert(mintInfo?.owner.equals(quote.baseTokenProgram),'Purchased mint owner differs.');
  const ata=getAssociatedTokenAddressSync(key(target.mint),vault,true,quote.baseTokenProgram);
  const wsol=getAssociatedTokenAddressSync(NATIVE_MINT,vault,true,TOKEN_PROGRAM_ID);
  const market=quote.curve?bondingCurvePda(key(target.mint)):key(target.pool);
  const expected=[authority,creator,sourceMint,deriveFeeRouter(program).address,policyKey,vault,key(target.mint),ata,wsol,market,receipt,
    quote.baseTokenProgram,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,quote.pumpBuyInstruction.programId,SystemProgram.programId,priceConfigAddress(program),signer];
  assert(expected.every((p,i)=>ix.keys[i].pubkey.equals(p)),'Buyback custody addresses differ.');
  // The SDK chooses a protocol recipient randomly. Accept only current on-chain
  // allowlisted recipients, and recompute their ATAs before comparing ALL keys.
  const buy=quote.pumpBuyInstruction;
  for(const [index,allowed] of quote.recipientChoices){
    const candidate=ix.keys[18+index]?.pubkey;
    assert(candidate&&allowed?.some(p=>p.equals(candidate)),'Unapproved Pump fee recipient.');
    buy.keys[index]={...buy.keys[index],pubkey:candidate};
    if(!quote.curve)buy.keys[index+1]={...buy.keys[index+1],pubkey:getAssociatedTokenAddressSync(NATIVE_MINT,candidate,true,TOKEN_PROGRAM_ID)};
  }
  assert(ix.keys.length===18+buy.keys.length&&buy.keys.every((k,i)=>ix.keys[18+i].pubkey.equals(k.pubkey)),'Pump accounts differ from finalized market.');
  const metas=expected.map((pubkey,i)=>({pubkey,isSigner:i===0||i===17,isWritable:[0,4,5,6,7,8,9,10].includes(i)}));
  metas.push(...buy.keys.map((k,i)=>({...k,isSigner:i===(quote.curve?6:1)?false:k.isSigner})));
  const setup=v3BuybackFeeSetup({pumpBuyInstruction:buy,authority,
    curveCreatorVaultRentLamports:quote.curveCreatorVaultRentLamports||'0'}),before=ixs.slice(0,-1);
  const compute=before.filter(i=>i.programId.equals(ComputeBudgetProgram.programId));
  validateComputeInstructions(compute);
  assert(before.length===compute.length+setup.length,'Unexpected setup instructions.');
  const canonical=new TransactionMessage({payerKey:authority,recentBlockhash:message.recentBlockhash,
    instructions:[...compute,...setup,{...ix,keys:metas}]}).compileToV0Message(tables);
  assert(Buffer.from(canonical.serialize()).equals(Buffer.from(message.serialize())),'Noncanonical instruction order, flags or accounts.');
  const reserve=await verifyV3BuybackAuthorityReserve({connection,transaction,authority,priceSigner:signer,setupCount:setup.length});
  assert(reserve.ready,'Protected authority reserve is insufficient.');
  const simulation=await connection.simulateTransaction(transaction,{sigVerify:false,replaceRecentBlockhash:true,commitment:'finalized',
    accounts:{encoding:'base64',addresses:[String(vault),target.mint,String(ata),String(receipt),String(policyKey)]}});
  assert(!simulation.value.err,'Independent simulation rejected the transaction.');
  const [afterVault,afterMint,afterAta,afterReceipt,afterPolicy]=simulation.value.accounts||[];
  const bytes=a=>Buffer.from(a?.data?.[0]||'','base64');
  const receiptBytes=bytes(afterReceipt),mintBytes=bytes(afterMint),ataBytes=bytes(afterAta),policyBytes=bytes(afterPolicy);
  const spent=BigInt(vaultInfo.lamports)-BigInt(afterVault?.lamports||0);
  assert(afterMint?.owner===String(quote.baseTokenProgram)&&mintBytes.length>=82&&afterAta?.owner===String(quote.baseTokenProgram)
    &&ataBytes.length>=165&&ataBytes.subarray(0,32).equals(key(target.mint).toBuffer())&&ataBytes.subarray(32,64).equals(vault.toBuffer())
    &&ataBytes.readBigUInt64LE(64)===0n,'Simulated token custody is invalid.');
  const burned=mintInfo.data.readBigUInt64LE(36)-mintBytes.readBigUInt64LE(36);
  assert(afterVault?.owner===String(SystemProgram.programId)&&spent>0n&&spent<=args.quote&&burned>=args.minimum,'Simulated spend or burn differs.');
  assert(afterReceipt?.owner===config.programId&&receiptBytes.length===(args.agency?209:160)
    &&receiptBytes.subarray(0,8).equals(disc(args.agency?'account:AgencyBuybackV3':'account:MintBuybackV3'))
    &&receiptBytes.subarray(8,40).equals(args.id)&&receiptBytes.subarray(40,72).equals(sourceMint.toBuffer())
    &&receiptBytes.subarray(72,104).equals(key(target.mint).toBuffer())&&receiptBytes.subarray(104,136).equals(market.toBuffer())
    &&receiptBytes.readBigUInt64LE(136)===spent&&receiptBytes.readBigUInt64LE(144)===burned,'Simulated immutable receipt differs.');
  assert(afterPolicy?.owner===config.programId&&policyBytes.length===policyInfo.data.length
    &&policyBytes.readBigUInt64LE((args.agency?204:192)+category*8)===policy.withdrawnLamports[category]+spent
    &&(!args.ownCoin||policyBytes.readBigUInt64LE(305+args.agent*8)===policy.agentSpent[args.agent]+spent&&(policyBytes[329]&(1<<args.agent))!==0),'Simulated policy debit differs.');
  assert(Date.now()-started<35000,'Review expired before signing.');
  return{transaction,messageHash:hash(message.serialize()),programId:config.programId,vault:String(vault),receipt:String(receipt),
    quote:String(args.quote),minimum:String(args.minimum),simulatedSpent:String(spent),simulatedBurned:String(burned),slot,
    blockhash:message.recentBlockhash};
}
