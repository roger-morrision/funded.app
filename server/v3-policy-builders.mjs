import {buildMintRouterV3SettlementInstruction} from '../mint-router-v3.js';
import {buildProtectedMintV3ApprovalInstruction,buildProtectedMintV3DisbursementInstruction} from '../protected-mint-router-v3.js';
import {deriveSolCreditV3} from '../mint-router-v3-token.js';
import {buildAgencyMintV3SettlementInstruction,buildAgencyMintV3ApprovalInstruction,buildAgencyMintV3DisbursementInstruction} from '../agency-mint-router-v3.js';

// Route from the signed immutable protocol snapshot, never a caller's generic
// version string. Full account and finalized receipt checks remain mandatory.
export const buildV3PolicySettlement=input=>(input.split?.agencyPercent!==undefined?buildAgencyMintV3SettlementInstruction:buildMintRouterV3SettlementInstruction)(input);
// An agency coin with paired-token conversions must pass its SOL credit record
// to settlement, or the router rejects it. Null when the coin has none.
export async function v3SettlementSolCredit({connection,programId,mint,split}){
  if(split?.agencyPercent===undefined)return null;
  const address=deriveSolCreditV3(programId,mint);
  return await connection.getAccountInfo(address,'finalized')?address:null;
}
// A finalized settlement may carry the credit record as one extra account.
export function settlementWithOptionalCredit(input,accountCount){
  const plain=buildV3PolicySettlement(input);
  return input.split?.agencyPercent!==undefined&&accountCount===plain.instruction.keys.length+1
    ?buildV3PolicySettlement({...input,solCredit:deriveSolCreditV3(input.programId,input.mint)}):plain;
}
export const buildV3AutoPolicySettlement=input=>buildV3PolicySettlement({...input,auto:true});
export const buildV3PolicyApproval=input=>(input.split?.agencyPercent!==undefined?buildAgencyMintV3ApprovalInstruction:buildProtectedMintV3ApprovalInstruction)(input);
export const buildV3PolicyDisbursement=input=>(input.split?.agencyPercent!==undefined?buildAgencyMintV3DisbursementInstruction:buildProtectedMintV3DisbursementInstruction)(input);
