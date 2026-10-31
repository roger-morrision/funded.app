import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import bs58 from 'bs58';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,VersionedTransaction,sendAndConfirmTransaction} from '@solana/web3.js';
import {OnlinePumpSdk,PUMP_SDK} from '@pump-fun/pump-sdk';
import {buildProtectedMintRouterV3InitializeInstruction,buildMintRouterV3SettlementInstruction,deriveMintVaultsV3} from '../mint-router-v3.js';
import {buildProtectedMintV3ApprovalInstruction,buildProtectedMintV3DisbursementInstruction} from '../protected-mint-router-v3.js';
import {PROTOCOL_FEE_SPLIT} from '../config/protocol-fee-split.js';
import {buildTradeTransaction} from '../pump-trading.js';
import {buildMintCreatorFeeCollectionInstructions} from '../server/pump-fee-collection.mjs';
import {loadFinalizedV3PumpCollection} from '../server/v3-finalized-collection.mjs';
import {loadFinalizedV3Settlement} from '../server/v3-settlement-proof.mjs';
import {loadFinalizedV3RewardFunding} from '../server/v3-reward-funding-proof.mjs';
import {ensureMintAutomationV3} from '../server/mint-automation-v3.mjs';
import {readProgramDataEvidence,createAutomaticRewardChain} from '../server/automatic-reward-chain.mjs';
import {buildRewardManifest,createRewardCycleId} from '../reward-merkle.js';
import {quoteV3Buyback} from '../server/v3-buyback-quote.mjs';
import {buildV3BuybackInstruction,v3BuybackId} from '../server/v3-buyback-instruction.mjs';
import {prepareV3BuybackTransaction} from '../server/v3-buyback-transaction.mjs';
import {loadFinalizedV3Buyback} from '../server/v3-buyback-proof.mjs';

const connection=new Connection(process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com',{commitment:'finalized',disableRetryOnRateLimit:true});
assert.equal(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const deployed=JSON.parse(await readFile('tmp/automation-release/deployed-program.json','utf8'));
const programId=new PublicKey(deployed.program),authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY||''));
assert.equal(authority.publicKey.toBase58(),'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
assert.equal((await readProgramDataEvidence(connection,programId)).sha256,deployed.programDataSha256);
const creator=Keypair.generate(),mint=Keypair.generate(),holder=Keypair.generate(),referrer=Keypair.generate(),operations=Keypair.generate();
const output='tmp/automation-release/e2e.json';await mkdir('tmp/automation-release',{recursive:true});
const report={status:'running',cluster:'devnet',program:programId.toBase58(),mint:mint.publicKey.toBase58(),creator:creator.publicKey.toBase58(),
  transactions:[],checks:[],limitations:['Direct on-chain integration; browser launch registration is tested separately.',
    'Reward manifest uses disposable test recipients; live holder eligibility and OAuth identity are not established.',
    'A real Pump migration is not forced by this bounded test.']};
async function record(stage,data){report.checks.push({stage,...data});await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({stage,...data}));}
async function send(stage,instructions,signers=[authority]){
  const signature=await sendAndConfirmTransaction(connection,new Transaction().add(...instructions),signers,{commitment:'finalized',skipPreflight:false,maxRetries:2});
  report.transactions.push({stage,signature});await record(stage,{signature});return signature;
}
await send('fund-disposable-wallets',[SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:creator.publicKey,lamports:150000000}),
  ...[holder,referrer,operations].map(k=>SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:k.publicKey,lamports:1000000}))]);
const shares={creatorWalletPercent:60,holderAirdropPercent:10,solClaimPercent:10};
const initialized=buildProtectedMintRouterV3InitializeInstruction({programId,mint:mint.publicKey,authority:authority.publicKey,creator:creator.publicKey,shares});
await send('initialize-protected-policy',[initialized.instruction],[creator,mint]);
const launchSignature=await send('pump-launch',[await PUMP_SDK.createV2Instruction({mint:mint.publicKey,name:'Automation QA '+Date.now().toString(36),
  symbol:'AUTOQA',uri:'https://funded.vip/devnet-metadata/'+mint.publicKey.toBase58(),creator:initialized.router.address,user:creator.publicKey,mayhemMode:false,holderReward:false})],[creator,mint]);
const launch={mint:mint.publicKey.toBase58(),cluster:'devnet',onchainVerified:true,creator:initialized.router.address.toBase58(),creatorWallet:creator.publicKey.toBase58(),
  pumpFeeRoute:{scope:'per-mint-v3',programId:programId.toBase58(),router:initialized.router.address.toBase58(),transaction:launchSignature,
    initialAuthority:authority.publicKey.toBase58(),protocolSplit:PROTOCOL_FEE_SPLIT}};
await writeFile('tmp/automation-release/qa-launch.json',JSON.stringify(launch,null,2));
let buy;
for(let index=0;index<4;index++){
  buy=await buildTradeTransaction({connection,side:'buy',mint:mint.publicKey,user:authority.publicKey,amount:0.2,slippagePercent:2,feeOwner:creator.publicKey});
  await send('pump-buy-'+index,buy.instructions);
}
const sell=await buildTradeTransaction({connection,side:'sell',mint:mint.publicKey,user:authority.publicKey,
  amount:Number(buy.outputAmount.toString())/(10**buy.tokenDecimals)/10,slippagePercent:2,feeOwner:creator.publicKey});
await send('pump-sell',sell.instructions);
const collection=await buildMintCreatorFeeCollectionInstructions({connection,router:initialized.router.address,keeper:authority.publicKey});
const collectionSignature=await send('permissionless-collection',collection.instructions);
const source=await loadFinalizedV3PumpCollection({connection,signature:collectionSignature,programId,mint:mint.publicKey,launch});
assert(source?.expectedLamports>0n);
const settlement=buildMintRouterV3SettlementInstruction({programId,mint:mint.publicKey,authority:authority.publicKey,creator:creator.publicKey,
  claimId:source.claimId,expectedLamports:source.expectedLamports,auto:true});
const settlementSignature=await send('automatic-settlement',[settlement.instruction]);
const proof=await loadFinalizedV3Settlement({connection,signature:settlementSignature,programId,mint:mint.publicKey,authority:authority.publicKey,
  creator:creator.publicKey,claimId:source.claimId,expectedLamports:source.expectedLamports,split:PROTOCOL_FEE_SPLIT});
assert.equal(proof?.authorization,'authority-fixed-policy');await record('exact-fee-allocation',{collectedLamports:String(source.expectedLamports),categories:proof.categoryLamports});
await ensureMintAutomationV3({connection,authority,programId,mint:mint.publicKey,creator:creator.publicKey,policy:initialized.policy.address,
  recipients:[operations.publicKey,referrer.publicKey,PublicKey.default,PublicKey.default]});
const chain=createAutomaticRewardChain({connection,programId,authority,expectedProgramDataSha256:deployed.programDataSha256});
const rewardVault=await chain.ensureVault(mint.publicKey);
const creatorPool=BigInt(proof.categoryLamports[0]),walletAmount=creatorPool*60n/80n,holderAmount=creatorPool*70n/80n-walletAmount;
const rewardAmount=creatorPool-walletAmount;
for(const [stage,category,beneficiary,recipient,amount,holderPart] of [
  ['creator-wallet',0,0,creator.publicKey,walletAmount,0n],['holder-x-funding',0,1,rewardVault,rewardAmount,holderAmount],
  ['daily-bonus-funding',5,7,rewardVault,BigInt(proof.categoryLamports[5]),0n],
  ['operations',1,3,operations.publicKey,BigInt(proof.categoryLamports[1]),0n],
  ['referral-level-1',2,4,referrer.publicKey,BigInt(proof.categoryLamports[2]),0n]]){
  if(!amount)continue;
  const input={programId,mint:mint.publicKey,authority:authority.publicKey,creator:creator.publicKey,withdrawalId:randomBytes(32),category,beneficiary,
    recipient,amount,holderAmount:holderPart,auto:true};
  const ix=buildProtectedMintV3DisbursementInstruction(input),approval=category>=1&&category<=4?buildProtectedMintV3ApprovalInstruction(input):null;
  const signature=await send('automatic-'+stage,approval?[approval.instruction,ix.instruction]:[ix.instruction]);
  const paid=await loadFinalizedV3RewardFunding({...input,connection,signature,initialAuthority:authority.publicKey,split:PROTOCOL_FEE_SPLIT,protectedPolicy:true});
  assert.equal(paid?.balanceDeltaVerified,true);assert.equal(paid.authorization,'immutable-mint-automation');
}
const now=Math.floor(Date.now()/1000),cycleId=createRewardCycleId({mint:mint.publicKey.toBase58(),kind:'automation-fixture',asset:'SOL',periodStart:now-60,periodEnd:now});
const manifest=buildRewardManifest({cycleId,allocations:[{recipient:holder.publicKey.toBase58(),amount:String(holderAmount)}]});
const plan={mint:mint.publicKey.toBase58(),manifest,cutoffAt:now,payoutAt:now};await chain.ensureCycle(plan);
const payment=await chain.submitLeaf(plan,manifest.leaves[0]);assert(payment.finalized&&payment.balanceDeltaVerified);
await record('proof-gated-holder-payment',{signature:payment.signature,amount:payment.amountReceived});
const budget=BigInt(proof.categoryLamports[6]),vault=deriveMintVaultsV3(programId,mint.publicKey)[6];
const quote=await quoteV3Buyback({connection,vault,budgetLamports:String(budget)}),buybackId=v3BuybackId([collectionSignature]);
const built=buildV3BuybackInstruction({programId,sourceMint:mint.publicKey,creator:creator.publicKey,authority:authority.publicKey,buybackId,...quote});
const lookup=await connection.getAddressLookupTable(new PublicKey(process.env.FUNDED_BUYBACK_LOOKUP_TABLE||'FDx4KpYEkjkfBg7nefPCeNY3tL5kJT4mFTFtsfej58U4'),{commitment:'finalized'});
assert(lookup.value);const latest=await connection.getLatestBlockhash('finalized');
const prepared=prepareV3BuybackTransaction({instruction:built.instruction,authority:authority.publicKey,blockhash:latest.blockhash,lookupTable:lookup.value});
const tx=VersionedTransaction.deserialize(Buffer.from(prepared,'base64'));tx.sign([authority]);
const signature=await connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:2});
assert.equal((await connection.confirmTransaction({signature,...latest},'finalized')).value.err,null);
const burn=await loadFinalizedV3Buyback({connection,signature,programId,sourceMint:mint.publicKey,creator:creator.publicKey,
  initialAuthority:authority.publicKey,authority:authority.publicKey,buybackId,...quote,split:PROTOCOL_FEE_SPLIT});
assert(burn?.finalized);await record('pump-funded-buyback-and-burn',burn);
report.status='passed-bounded-real-devnet';await writeFile(output,JSON.stringify(report,null,2));
