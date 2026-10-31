import {Transaction,sendAndConfirmTransaction} from '@solana/web3.js';
import {buildInitializeMintAutomationV3,verifyMintAutomationV3} from '../mint-automation-v3.js';

export async function ensureMintAutomationV3({connection,authority,...input}) {
  const built=buildInitializeMintAutomationV3({...input,authority:authority.publicKey});
  let info=await connection.getAccountInfo(built.automation,'finalized');
  if(!info){
    await sendAndConfirmTransaction(connection,new Transaction().add(built.instruction),[authority],
      {commitment:'finalized',skipPreflight:false,maxRetries:2});
    info=await connection.getAccountInfo(built.automation,'finalized');
  }
  if(!verifyMintAutomationV3(info,input))throw new Error('Immutable automation destinations differ from the verified mint policy.');
  return built.automation;
}
