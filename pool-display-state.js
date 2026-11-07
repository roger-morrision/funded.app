import BN from 'bn.js';
import { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, poolPda } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackAccount, unpackMint } from '@solana/spl-token';

// A display snapshot needs the pool, mint and vaults. It does not need fee
// configs, a user's ATAs or swap-instruction state. Trading still uses the SDK's
// full fresh quote path before signing.
export async function readPoolDisplayState({connection, mintKey, poolKey, decodePool = info => PUMP_AMM_SDK.decodePool(info)}) {
  const [[poolInfo, mintInfo], slot] = await Promise.all([
    connection.getMultipleAccountsInfo([poolKey, mintKey], 'confirmed'),
    connection.getSlot('confirmed'),
  ]);
  if (!poolInfo?.owner?.equals(PUMP_AMM_PROGRAM_ID)
    || !(mintInfo?.owner?.equals(TOKEN_PROGRAM_ID) || mintInfo?.owner?.equals(TOKEN_2022_PROGRAM_ID))) throw Error('Pool or mint ownership could not be verified.');
  const pool = decodePool(poolInfo), mint = unpackMint(mintKey, mintInfo, mintInfo.owner);
  if (!mint.isInitialized || !pool.baseMint.equals(mintKey) || !pool.quoteMint.equals(NATIVE_MINT)
    || !poolPda(pool.index,pool.creator,mintKey,NATIVE_MINT).equals(poolKey)) throw Error('Pool identity could not be verified.');
  const [baseInfo, quoteInfo] = await connection.getMultipleAccountsInfo([pool.poolBaseTokenAccount,pool.poolQuoteTokenAccount], 'confirmed');
  const base = unpackAccount(pool.poolBaseTokenAccount,baseInfo,mintInfo.owner);
  const quote = unpackAccount(pool.poolQuoteTokenAccount,quoteInfo,TOKEN_PROGRAM_ID);
  if (!base.isInitialized || !quote.isInitialized || !base.mint.equals(mintKey) || !quote.mint.equals(NATIVE_MINT)
    || !base.owner.equals(poolKey) || !quote.owner.equals(poolKey) || base.amount <= 0n || quote.amount <= 0n) throw Error('Pool vault balances could not be verified.');
  return {slot,tokenDecimals:mint.decimals,state:{pool,poolAccountInfo:poolInfo,baseMint:mintKey,
    poolBaseAmount:new BN(base.amount.toString()),poolQuoteAmount:new BN(quote.amount.toString())}};
}
