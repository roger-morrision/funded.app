import { ComputeBudgetProgram, PublicKey, Transaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getBuyTokenAmountFromSolAmount, OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import BN from 'bn.js';

// One transaction that creates a pump.fun coin paired with `quoteMint`. The
// creator's wallet pays and is Pump's creator. A first buy is offered only for
// SOL pairs, since a token pair would need the creator to hold that token.
export async function buildPairLaunchTransaction({ connection, user, mint, name, symbol, uri, quoteMint, firstBuySol = 0 }) {
  const quote = new PublicKey(quoteMint || NATIVE_MINT);
  const solPair = quote.equals(NATIVE_MINT);
  let quoteTokenProgram = TOKEN_PROGRAM_ID;
  if (!solPair) {
    const info = await connection.getAccountInfo(quote, 'confirmed');
    if (!info) throw new Error('The paired token was not found on Solana.');
    if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('The paired token is not an SPL token.');
    quoteTokenProgram = info.owner;
  }
  const common = { mint, name, symbol, uri, creator: user, user, mayhemMode: false, holderReward: false };
  let instructions, firstBuy = null;
  const lamports = BigInt(Math.round(Number(firstBuySol || 0) * 1e9));
  if (solPair && lamports > 0n) {
    const global = await new OnlinePumpSdk(connection).fetchGlobal();
    const amount = BigInt(getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: null, bondingCurve: null,
      amount: new BN(lamports.toString()), quoteMint: NATIVE_MINT }).toString());
    if (amount <= 0n) throw new Error('The first buy is too small to receive tokens.');
    const maxLamports = lamports + lamports / 100n;
    instructions = await PUMP_SDK.createV2AndBuyInstructions({ ...common, global, amount: new BN(amount.toString()), solAmount: new BN(maxLamports.toString()), cashback: false });
    firstBuy = { tokens: amount, maxLamports };
  } else {
    instructions = [await PUMP_SDK.createV2Instruction({ ...common, ...(solPair ? {} : { quoteMint: quote, quoteTokenProgram }) })];
  }
  const transaction = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: solPair ? 300_000 : 450_000 }), ...instructions);
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = user;
  return { transaction, lastValidBlockHeight: latest.lastValidBlockHeight, quoteMint: quote.toBase58(), solPair, firstBuy };
}
