import BN from 'bn.js';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync,unpackMint} from '@solana/spl-token';
import {PUMP_PROGRAM_ID,PUMP_SDK,GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,PUMP_FEE_PROGRAM_ID,
  bondingCurvePda,getBuyTokenAmountFromSolAmount} from '@pump-fun/pump-sdk';
import {BUYBACK_POLICY} from '../buyback-policy.js';

export {PUMP_PROGRAM_ID,bondingCurvePda};
export const CURVE_BUY=Buffer.from([102,6,61,18,1,218,235,234]);
export const isCurveBuy=buy=>buy?.programId?.equals(PUMP_PROGRAM_ID)===true;

// Never infer migration from an RPC error. A missing curve permits the existing
// approved AMM route; an active curve must use its canonical Pump market.
export async function readBuybackCurve(connection,mint) {
  const address=bondingCurvePda(mint),account=await connection.getAccountInfo(address,'finalized');
  if(!account)return null;
  if(!account.owner.equals(PUMP_PROGRAM_ID))throw Error('The $RICH bonding curve has an invalid owner.');
  const curve=PUMP_SDK.decodeBondingCurve(account);
  return {address,account,curve};
}

export function validateCurveBuy(buy,{mint,vault,baseTokenProgram}) {
  const ata=getAssociatedTokenAddressSync(mint,vault,true,baseTokenProgram);
  const expected=[[0,GLOBAL_PDA],[2,mint],[3,bondingCurvePda(mint)],
    [4,getAssociatedTokenAddressSync(mint,bondingCurvePda(mint),true,baseTokenProgram)],
    [5,ata],[6,vault],[7,SystemProgram.programId],[8,baseTokenProgram],[11,PUMP_PROGRAM_ID],
    [14,PUMP_FEE_CONFIG_PDA],[15,PUMP_FEE_PROGRAM_ID]];
  if(!isCurveBuy(buy)||buy.keys?.length!==18||Buffer.from(buy.data||[]).length!==25
    ||!Buffer.from(buy.data).subarray(0,8).equals(CURVE_BUY)
    ||expected.some(([i,key])=>!buy.keys[i]?.pubkey.equals(key))
    ||buy.keys.some((key,i)=>key.isSigner&&i!==6))
    throw Error('Pump curve buy does not use the approved mint and vault custody.');
  return buy;
}

export async function quoteCurveBuyback({connection,mint,vault,budgetLamports,
  snapshot,quoteOutput=getBuyTokenAmountFromSolAmount,buildBuy=args=>PUMP_SDK.buyInstructions(args)}) {
  const [mintInfo,globalInfo,feeInfo]=await connection.getMultipleAccountsInfo(
    [mint,GLOBAL_PDA,PUMP_FEE_CONFIG_PDA],'finalized');
  if(!mintInfo||![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(key=>key.equals(mintInfo.owner))
    ||!globalInfo?.owner.equals(PUMP_PROGRAM_ID)||!feeInfo?.owner.equals(PUMP_FEE_PROGRAM_ID))
    throw Error('Finalized Pump curve mint and fee configuration are unavailable.');
  const {curve,account}=snapshot;
  if(curve.complete||curve.isMayhemMode||curve.isCashbackCoin
    ||curve.quoteMint&&!curve.quoteMint.equals(PublicKey.default)&&!curve.quoteMint.equals(NATIVE_MINT))
    throw Error('The $RICH curve is completed or uses an unsupported market mode.');
  const reserve=BigInt(curve.virtualQuoteReserves.toString()),realTokens=BigInt(curve.realTokenReserves.toString());
  const budget=BigInt(budgetLamports),cap=reserve*BigInt(BUYBACK_POLICY.maximumLiquidityClipBps)/10000n;
  const spend=budget<cap?budget:cap;
  if(spend<10000n||realTokens<=0n)throw Error('Insufficient curve liquidity for a protected $RICH buyback.');
  const global=PUMP_SDK.decodeGlobal(globalInfo),feeConfig=PUMP_SDK.decodeFeeConfig(feeInfo);
  const mintSupply=new BN(String(unpackMint(mint,mintInfo,mintInfo.owner).supply));
  const quoted=quoteOutput({global,feeConfig,mintSupply,bondingCurve:curve,
    amount:new BN(String(spend)),quoteMint:NATIVE_MINT});
  const minimum=BigInt(quoted.toString())*BigInt(10000-BUYBACK_POLICY.maximumSlippageBps)/10000n;
  if(minimum<=0n||minimum>=realTokens)throw Error('The protected buyback would exhaust the bonding curve; retry after migration.');
  const instructions=await buildBuy({global,bondingCurveAccountInfo:account,bondingCurve:curve,
    associatedUserAccountInfo:null,mint,user:vault,amount:new BN(String(minimum)),
    solAmount:new BN(String(spend)),slippage:0,tokenProgram:mintInfo.owner});
  const buys=instructions.filter(ix=>isCurveBuy(ix)&&Buffer.from(ix.data||[]).subarray(0,8).equals(CURVE_BUY));
  if(buys.length!==1)throw Error('A unique Pump curve purchase is required.');
  const buy=validateCurveBuy(buys[0],{mint,vault,baseTokenProgram:mintInfo.owner});
  const creatorVault=PublicKey.findProgramAddressSync([Buffer.from('creator-vault'),curve.creator.toBuffer()],PUMP_PROGRAM_ID)[0];
  if(!buy.keys[9].pubkey.equals(creatorVault))throw Error('Pump creator-fee vault differs.');
  const [creatorInfo,rent]=await Promise.all([connection.getAccountInfo(creatorVault,'finalized'),
    connection.getMinimumBalanceForRentExemption(0,'finalized')]);
  if(creatorInfo&&(!creatorInfo.owner.equals(SystemProgram.programId)||creatorInfo.data.length!==0)
    ||!Number.isSafeInteger(rent)||rent<=0||rent>5000000)throw Error('Pump creator-fee rent is unavailable.');
  const curveCreatorVaultRentLamports=String(Math.max(0,rent-(creatorInfo?.lamports||0)));
  // The router reconstructs this exact-output purchase and burns it atomically.
  return {pumpBuyInstruction:buy,baseTokenProgram:mintInfo.owner,market:'pump-curve',curveCreatorVaultRentLamports,
    spendableQuoteIn:String(spend),maxTotalDebit:String(spend),minBaseAmountOut:String(minimum)};
}
