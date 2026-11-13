import { ComputeBudgetProgram, PublicKey, Transaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getBuyTokenAmountFromSolAmount, OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import BN from 'bn.js';

// One transaction that creates a pump.fun coin paired with `quoteMint`. The
// creator's wallet pays and is Pump's creator. A first buy is offered only for
// SOL pairs, since a token pair would need the creator to hold that token.
// Fits Solana's packet limit once the creator and the new mint have signed.
function fits(transaction) {
  try {
    const message = transaction.compileMessage();
    return 1 + 64 * message.header.numRequiredSignatures + message.serialize().length <= 1232;
  } catch { return false; }
}

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
  const latest = await connection.getLatestBlockhash('confirmed');
  const assemble = list => Object.assign(new Transaction().add(...list), { recentBlockhash: latest.blockhash, feePayer: user });
  // Token-quoted creates need a higher compute limit; SOL create + buy fits the default.
  let transaction = assemble(solPair ? instructions : [ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }), ...instructions]);
  let deferredBuySol = 0;
  // Create + first buy can exceed Solana's 1232-byte limit (long metadata links,
  // long names): then create alone, and the first buy follows as a normal trade.
  if (firstBuy && !fits(transaction)) {
    transaction = assemble([await PUMP_SDK.createV2Instruction({ ...common })]);
    deferredBuySol = Number(lamports) / 1e9; firstBuy = null;
  }
  if (!fits(transaction)) throw new Error('The coin details are too long for one Solana transaction. Shorten the name or links.');
  return { transaction, lastValidBlockHeight: latest.lastValidBlockHeight, quoteMint: quote.toBase58(), solPair, firstBuy, deferredBuySol };
}
