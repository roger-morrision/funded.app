import { PublicKey } from '@solana/web3.js';
import { GLOBAL_PDA, PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda, PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, unpackMint } from '@solana/spl-token';
import { decodePoolDisplayState } from './pool-display-state.js';
import { formatBondingCurveSnapshot, formatGraduatedPoolSnapshot } from './pump-trading.js';
import { assertRpcNetwork } from './solana-network.js';

// All addresses are deterministic. Read both possible base ATAs so discovering
// the mint's token program does not require another network round trip.
// This is display-only; trade construction still fetches fresh SDK quote state.
export async function readCoinDisplaySnapshot({connection,mint,poolAddress,cluster,
  decodeCurve = info => PUMP_SDK.decodeBondingCurve(info),
  decodeGlobal = info => PUMP_SDK.decodeGlobal(info),
  decodePool = info => PUMP_AMM_SDK.decodePool(info)}) {
  // Platform tokens can use a configured, non-migration pool. Verify the network
  // and read that pool with the mint/vault batch instead of loading swap state.
  if (poolAddress) await assertRpcNetwork(connection,cluster);
  const mintKey = new PublicKey(mint), canonicalPool = canonicalPumpPoolPda(mintKey,NATIVE_MINT);
  const poolKey = poolAddress ? new PublicKey(poolAddress) : canonicalPool;
  const baseKeys = [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].map(program => getAssociatedTokenAddressSync(mintKey,poolKey,true,program));
  const quoteKey = getAssociatedTokenAddressSync(NATIVE_MINT,poolKey,true,TOKEN_PROGRAM_ID);
  const {context,value} = await connection.getMultipleAccountsInfoAndContext(
    [mintKey,bondingCurvePda(mintKey),GLOBAL_PDA,poolKey,...baseKeys,quoteKey], 'confirmed');
  const [mintInfo,curveInfo,globalInfo,poolInfo,legacyBase,extendedBase,quoteInfo] = value;
  if (!(mintInfo?.owner?.equals(TOKEN_PROGRAM_ID) || mintInfo?.owner?.equals(TOKEN_2022_PROGRAM_ID))) throw Error('Mint ownership could not be verified.');
  const parsed = unpackMint(mintKey,mintInfo,mintInfo.owner);
  if (!parsed.isInitialized) throw Error('Mint is not initialized.');
  const slot=context.slot, observedAt=new Date().toISOString();
  let curve=null, pool=null, initialRealTokenReserves=null;
  if (globalInfo?.owner?.equals(PUMP_PROGRAM_ID)) {
    try { initialRealTokenReserves=decodeGlobal(globalInfo).initialRealTokenReserves; } catch {}
  }
  if (curveInfo?.owner?.equals(PUMP_PROGRAM_ID) && parsed.decimals===6) {
    try {
      const bondingCurve=decodeCurve(curveInfo), quote=bondingCurve.quoteMint;
      if (!quote || quote.equals(PublicKey.default) || quote.equals(NATIVE_MINT)) {
        curve=formatBondingCurveSnapshot({mint:mintKey,bondingCurve,slot,observedAt,initialRealTokenReserves});
      }
    } catch {}
  }
  if ((!curve || curve.complete) && (!curveInfo || poolKey.equals(canonicalPool))) {
    try {
      const decoded=decodePool(poolInfo), baseIndex=mintInfo.owner.equals(TOKEN_PROGRAM_ID)?0:1;
      if (!decoded.poolBaseTokenAccount.equals(baseKeys[baseIndex]) || !decoded.poolQuoteTokenAccount.equals(quoteKey)) throw Error('Pool vault addresses could not be verified.');
      const {state,tokenDecimals}=decodePoolDisplayState({mintKey,poolKey,poolInfo,mintInfo,
        baseInfo:baseIndex===0?legacyBase:extendedBase,quoteInfo,slot,decodePool:()=>decoded});
      pool=formatGraduatedPoolSnapshot({mint:mintKey,poolKey,state,tokenDecimals,slot,observedAt});
    } catch {}
  }
  // Match the parsed mint shape already consumed by the detail controller.
  return {curve,pool,mintInfo:{value:{owner:mintInfo.owner,data:{parsed:{info:{
    isInitialized:parsed.isInitialized,decimals:parsed.decimals,supply:parsed.supply.toString(),
    mintAuthority:parsed.mintAuthority?.toBase58() ?? null,
    freezeAuthority:parsed.freezeAuthority?.toBase58() ?? null,
  }}}}},slot};
}
