import {OnlinePumpSdk} from '@pump-fun/pump-sdk';
import {OnlinePumpAmmSdk} from '@pump-fun/pump-swap-sdk';
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';

// Both independent vaults are SOL-quoted for app launches. Supplying the known
// quote program avoids another mint lookup, and parallel reads reach the shared
// gateway together so it can batch account reads from the same commitment.
export async function readPumpCreatorFeeBalance({connection,creator,
  pump=new OnlinePumpSdk(connection),amm=new OnlinePumpAmmSdk(connection)}){
  const [native,wrapped]=await Promise.all([pump.getCreatorVaultBalance(creator),
    amm.getCoinCreatorVaultBalance(creator,NATIVE_MINT,TOKEN_PROGRAM_ID)]);
  return native.add(wrapped);
}
