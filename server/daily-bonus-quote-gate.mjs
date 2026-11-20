import { PublicKey, SystemProgram } from '@solana/web3.js';
import { bondingCurvePda, PUMP_SDK } from '@pump-fun/pump-sdk';
import { NATIVE_MINT } from '@solana/spl-token';

// Bonus rankings currently score raw lamports. A token-quoted trade cannot
// enter the same ranking until its finalized quote-to-USD evidence is indexed.
export async function assertSolQuotedBonusLaunches({ connection, launches }) {
  for (const launch of launches) {
    const mint = new PublicKey(launch.mint);
    const account = await connection.getAccountInfo(bondingCurvePda(mint), 'finalized');
    const curve = account && PUMP_SDK.decodeBondingCurveNullable(account);
    if (!curve?.quoteMint) throw new Error(`Daily bonus quote proof is unavailable for ${launch.mint}.`);
    if (!curve.quoteMint.equals(NATIVE_MINT) && !curve.quoteMint.equals(SystemProgram.programId))
      throw new Error(`Daily bonus common USD ranking lacks finalized price evidence for paired mint ${launch.mint}.`);
  }
}
