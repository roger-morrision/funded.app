import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token';
import {decodeTokenConversionV3,decodeSolCreditV3} from '../mint-router-v3-token.js';

const disc=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
const bytes=account=>Buffer.from(account?.data?.[0]||'','base64');
const lamports=value=>{assert(Number.isSafeInteger(value)&&value>=0,'Unsafe simulated balance.');return BigInt(value);};

// Validate the whole simulated category movement before a reservation/signature.
// No simulation response can substitute for a finalized payment proof later.
export function verifyTokenSellSimulation({simulation,program,built,beforeVault,beforeToken,ledgerInfo,policyInfo,
  creditInfo,amountIn,minSolOut,category,vaultRent,minimumContextSlot}){
  assert(!simulation.value.err&&simulation.context.slot>=minimumContextSlot,'Conversion simulation failed or is stale.');
  const [vault,token,wsol,receipt,credit,ledger,policy]=simulation.value.accounts||[];
  const expectedProgram=String(program),sourceMint=built.instruction.keys[1].pubkey;
  assert(vault?.owner===String(SystemProgram.programId)&&bytes(vault).length===0,'Simulated SOL vault custody differs.');
  assert(token?.owner===String(TOKEN_PROGRAM_ID),'Simulated USDC custody differs.');
  const state=unpackAccount(built.instruction.keys[7].pubkey,{...token,owner:TOKEN_PROGRAM_ID,data:bytes(token)},TOKEN_PROGRAM_ID);
  assert(state.mint.toBase58()===built.quoteMint&&state.owner.equals(built.vault)&&!state.isFrozen
    &&beforeToken.amount-state.amount===BigInt(amountIn),'Simulated exact USDC debit differs.');
  assert(wsol===null||wsol?.owner===String(SystemProgram.programId)&&wsol.lamports===0&&bytes(wsol).length===0,'Simulated WSOL did not close.');
  assert(receipt?.owner===expectedProgram&&!receipt.executable,'Simulated receipt is not program-owned.');
  const fact=decodeTokenConversionV3(bytes(receipt));
  assert(fact.conversionId===built.instruction.data.subarray(8,40).toString('hex')&&fact.mint===String(sourceMint)
    &&fact.quoteMint===built.quoteMint&&fact.pool===built.pool&&fact.category===category
    &&fact.spentQuote===BigInt(amountIn)&&fact.receivedLamports>=BigInt(minSolOut)&&fact.createdAt>0n,'Simulated immutable conversion receipt differs.');
  const before=lamports(beforeVault.lamports),rent=lamports(vaultRent),topup=before<rent?rent-before:0n;
  assert(rent>0n&&lamports(vault.lamports)-before-lamports(built.wsolPrefundLamports)-topup===fact.receivedLamports,'Simulated SOL credit includes prefund/rent or differs.');
  for(const account of [credit,ledger,policy])assert(account?.owner===expectedProgram&&!account.executable,'Simulated accounting owner differs.');
  const wantedLedger=Buffer.from(ledgerInfo.data),wantedPolicy=Buffer.from(policyInfo.data);
  wantedLedger.writeBigUInt64LE(wantedLedger.readBigUInt64LE(144+category*8)+BigInt(amountIn),144+category*8);
  wantedPolicy.writeBigUInt64LE(wantedPolicy.readBigUInt64LE(140+category*8)+fact.receivedLamports,140+category*8);
  assert(bytes(ledger).equals(wantedLedger)&&bytes(policy).equals(wantedPolicy),'Simulated category ledger or policy delta differs.');
  let wantedCredit;
  if(creditInfo)wantedCredit=Buffer.from(creditInfo.data);
  else{
    wantedCredit=Buffer.alloc(105);disc('MintSolCreditV3').copy(wantedCredit);sourceMint.toBuffer().copy(wantedCredit,8);
    wantedCredit[104]=PublicKey.findProgramAddressSync([Buffer.from('mint-sol-credit-v3'),sourceMint.toBuffer()],program)[1];
  }
  wantedCredit.writeBigUInt64LE(wantedCredit.readBigUInt64LE(40+category*8)+fact.receivedLamports,40+category*8);
  assert(bytes(credit).equals(wantedCredit),'Simulated category SOL credit differs.');
  const decoded=decodeSolCreditV3(bytes(credit));assert(decoded.mint===String(sourceMint),'Simulated credit mint differs.');
  return {spentQuoteRaw:String(fact.spentQuote),receivedLamports:String(fact.receivedLamports),balanceDeltaVerified:true};
}
