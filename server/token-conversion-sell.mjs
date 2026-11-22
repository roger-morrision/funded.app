import assert from 'node:assert/strict';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID,PUMP_AMM_SDK,PUMP_AMM_FEE_CONFIG_PDA,PUMP_FEE_PROGRAM_ID,coinCreatorVaultAuthorityPda} from '@pump-fun/pump-swap-sdk';
import {buildTokenConversionInstruction} from '../mint-router-v3-token.js';

export const USDC_SOL_SELL_MARKET=Object.freeze({mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  pool:'Gf7sXMoP8iRw4iiXmJ1nq4vxcRycbGXy5RL8a8LnTd3v'});
const key=value=>new PublicKey(value),sellDisc=Buffer.from('33e685a4017f83ad','hex');
const writable=new Set([0,1,5,6,7,8,10,17,22]);
const amount=value=>{
  assert(typeof value==='string'&&/^[1-9]\d*$/.test(value)&&BigInt(value)<=0xffffffffffffffffn,'Canonical positive u64 amount required.');
  return BigInt(value);
};
const ata=(owner,mint)=>getAssociatedTokenAddressSync(mint,owner,true,TOKEN_PROGRAM_ID);
const pda=seed=>PublicKey.findProgramAddressSync([Buffer.from(seed)],PUMP_AMM_PROGRAM_ID)[0];

// Pure construction/validation only. This module is not imported by a worker or
// signing service and does not add a pool to runtime or signer admission.
export function buildReviewedUsdcSellConversion({programId,mint,authority,priceSigner,conversionId,category,
  amountIn,minSolOut,pumpSellInstruction:swap,poolAccount,protocolRecipients,buybackRecipients}){
  const input=amount(amountIn),minimum=amount(minSolOut),program=key(programId),coin=key(mint);
  const operator=key(authority),price=key(priceSigner),quote=key(USDC_SOL_SELL_MARKET.mint),pool=key(USDC_SOL_SELL_MARKET.pool);
  assert([5,6,7].includes(Number(category)),'Unsupported conversion category.');
  assert(!operator.equals(price),'Independent price signer required.');
  assert(swap?.programId?.equals(PUMP_AMM_PROGRAM_ID)&&swap.keys?.length===23,'Exact standard PumpSwap sell metas required.');
  const data=Buffer.from(swap.data||[]);
  assert(data.length===24&&data.subarray(0,8).equals(sellDisc)&&data.readBigUInt64LE(8)===input
    &&data.readBigUInt64LE(16)===minimum,'Sell exact input or minimum differs.');
  assert(poolAccount?.owner?.equals(PUMP_AMM_PROGRAM_ID)&&!poolAccount.executable&&poolAccount.data.length>=245,'Verified PumpSwap pool bytes required.');
  const saved=PUMP_AMM_SDK.decodePool(poolAccount);
  assert(saved.baseMint.equals(quote)&&saved.quoteMint.equals(NATIVE_MINT)&&saved.coinCreator.equals(SystemProgram.programId)
    &&!saved.isMayhemMode&&!saved.isCashbackCoin,'Unsupported sell pool orientation or mode.');
  const vault=PublicKey.findProgramAddressSync([Buffer.from('mint-fee-vault-v3'),coin.toBuffer(),Buffer.from([Number(category)])],program)[0];
  const expected=new Map([[0,pool],[1,vault],[2,pda('global_config')],[3,quote],[4,NATIVE_MINT],
    [5,ata(vault,quote)],[6,ata(vault,NATIVE_MINT)],[7,saved.poolBaseTokenAccount],[8,saved.poolQuoteTokenAccount],
    [11,TOKEN_PROGRAM_ID],[12,TOKEN_PROGRAM_ID],[13,SystemProgram.programId],[14,ASSOCIATED_TOKEN_PROGRAM_ID],
    [15,pda('__event_authority')],[16,PUMP_AMM_PROGRAM_ID],[18,coinCreatorVaultAuthorityPda(saved.coinCreator)],
    [19,PUMP_AMM_FEE_CONFIG_PDA],[20,PUMP_FEE_PROGRAM_ID]]);
  for(const [index,address]of expected)assert(swap.keys[index].pubkey.equals(address),'Noncanonical sell custody account: '+index);
  swap.keys.forEach((meta,index)=>assert(meta.isSigner===(index===1)&&meta.isWritable===writable.has(index),'Noncanonical sell account flags: '+index));
  for(const [ownerIndex,ataIndex]of [[9,10],[18,17],[21,22]]){
    const owner=swap.keys[ownerIndex].pubkey;
    assert(!owner.equals(vault)&&ata(owner,NATIVE_MINT).equals(swap.keys[ataIndex].pubkey),'Noncanonical sell fee custody.');
  }
  for(const [index,allowed]of [[9,protocolRecipients],[21,buybackRecipients]])assert(Array.isArray(allowed)&&allowed.length>0
    &&allowed.some(address=>key(address).equals(swap.keys[index].pubkey)),'Sell fee recipient is not independently allowlisted.');
  const built=buildTokenConversionInstruction({programId:program,mint:coin,quoteMint:quote,quoteTokenProgram:TOKEN_PROGRAM_ID,
    authority:operator,priceSigner:price,conversionId,category,amountIn,minSolOut,pumpBuyInstruction:swap});
  assert(built.instruction.data.length===57&&built.instruction.keys.length===41,'Conversion ABI differs.');
  return {...built,direction:'sell-base-exact-input',quoteMint:String(quote),pool:String(pool),amountIn,minSolOut};
}

export function decodeTokenConversionIntent(data){
  const bytes=Buffer.from(data||[]);
  assert(bytes.length===57&&bytes.subarray(0,8).toString('hex')==='647795a88d096dab','Invalid conversion instruction.');
  const category=bytes[40],amountIn=String(bytes.readBigUInt64LE(41)),minSolOut=String(bytes.readBigUInt64LE(49));
  assert([5,6,7].includes(category),'Unsupported conversion category.');amount(amountIn);amount(minSolOut);
  return {conversionId:bytes.subarray(8,40).toString('hex'),category,amountIn,minSolOut};
}
