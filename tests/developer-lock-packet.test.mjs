import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Keypair,PublicKey,AddressLookupTableAccount} from '@solana/web3.js';
import {PUMP_SDK} from '@pump-fun/pump-sdk';
import {createBurnCheckedInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import BN from 'bn.js';
import {buildLaunchMintRouter} from '../launch-flow.js';
import {buildPumpLaunchPlan} from '../mint-router-launch.js';
import {launchReserveInstructions} from '../launch-community-reserve.js';
import {developerLockInstruction} from '../developer-token-lock.js';
import {launchServiceFeeInstructions} from '../launch-service-fee.js';
import {devnetLaunchMetadataUri as devnetMetadataUri} from '../devnet-metadata.js';
const saved=JSON.parse(readFileSync(new URL('./fixtures/developer-lock-launch-config.json',import.meta.url),'utf8'));
test('all launch tiers keep developer escrow, reserve, fee and burn atomic within packet limits (captured Devnet accounts)',async()=>{
 const payer=Keypair.generate().publicKey,global={feeRecipient:new PublicKey(saved.global.feeRecipient),feeRecipients:saved.global.feeRecipients.map(k=>new PublicKey(k))};
 const lookup=new AddressLookupTableAccount({key:new PublicKey(saved.lookup),state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,authority:payer,addresses:saved.addresses.map(k=>new PublicKey(k))}});
 const funded=new PublicKey(saved.fundedMint),tokenProgram=new PublicKey(saved.fundedTokenProgram);let checked=0;
 for(const long of [false,true])for(const buy of [0n,200_000_000_000_000n])for(const burnTokens of [0n,100_000n,250_000n]){
  const mint=Keypair.generate(),router=buildLaunchMintRouter({mint:mint.publicKey,payer,v3FeeRouter:saved.v3,feeShares:{creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0}});
  const launchInstructions=await PUMP_SDK.createV2AndBuyInstructions({global,mint:mint.publicKey,name:long?'N'.repeat(32):'EscrowQA',symbol:long?'T'.repeat(10):'EQA',uri:devnetMetadataUri(mint.publicKey.toBase58()),creator:router.router.address,user:payer,amount:new BN((30_000_000_000_000n+buy).toString()),solAmount:new BN(100000000),mayhemMode:false,cashback:false,holderReward:false});
  const reserve=launchReserveInstructions({mint:mint.publicKey,payer,programId:saved.v3.programId,authority:saved.v3.initialAuthority,reserveTokens:30000000,decimals:6});
  const quote={id:'launch_service_123_0123456789abcdef',payer:payer.toBase58(),recipient:saved.fees.recipient,policyHash:saved.fees.hash,expiresAt:new Date(Date.now()+60000).toISOString(),amountLamports:saved.fees.policy.launchLamports};
  const escrow=buy?developerLockInstruction({mint:mint.publicKey,creator:payer,amount:buy,quoteId:quote.id}).instruction:null;
  const burn=burnTokens?createBurnCheckedInstruction(getAssociatedTokenAddressSync(funded,payer,false,tokenProgram),funded,payer,burnTokens*1000000n,6,[],tokenProgram):null;
  const service=launchServiceFeeInstructions({payer,mint:mint.publicKey,quote,escrowReceiptMarker:buy>0n});
  const plan=buildPumpLaunchPlan({payer,mint,blockhash:PublicKey.default.toBase58(),launchInstructions,burnInstruction:burn,mintRouterInstruction:router.instruction,lookupTable:lookup,reserveInstructions:[...reserve.instructions,...(escrow?[escrow]:[]),...service]});
  assert(plan.steps.every(s=>s.bytes<=1232));const actual=plan.steps.at(-1).transaction.message.compiledInstructions.map(ix=>Buffer.from(ix.data));
  for(const ix of [...launchInstructions,...reserve.instructions,...service,...(escrow?[escrow]:[]),...(burn?[burn]:[])])assert(actual.some(data=>data.equals(ix.data)));
  checked++;
 }
 assert.equal(checked,12);
});
