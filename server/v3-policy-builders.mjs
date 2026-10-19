import {buildMintRouterV3SettlementInstruction} from '../mint-router-v3.js';
import {buildProtectedMintV3ApprovalInstruction,buildProtectedMintV3DisbursementInstruction} from '../protected-mint-router-v3.js';
import {buildAgencyMintV3SettlementInstruction,buildAgencyMintV3ApprovalInstruction,buildAgencyMintV3DisbursementInstruction} from '../agency-mint-router-v3.js';

// Route from the signed immutable protocol snapshot, never a caller's generic
// version string. Full account and finalized receipt checks remain mandatory.
export const buildV3PolicySettlement=input=>(input.split?.agencyPercent!==undefined?buildAgencyMintV3SettlementInstruction:buildMintRouterV3SettlementInstruction)(input);
export const buildV3PolicyApproval=input=>(input.split?.agencyPercent!==undefined?buildAgencyMintV3ApprovalInstruction:buildProtectedMintV3ApprovalInstruction)(input);
export const buildV3PolicyDisbursement=input=>(input.split?.agencyPercent!==undefined?buildAgencyMintV3DisbursementInstruction:buildProtectedMintV3DisbursementInstruction)(input);
