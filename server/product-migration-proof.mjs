import bs58 from 'bs58';
import { PublicKey, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_SDK, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';

const eventTag=Buffer.from('e445a52e51cb9a1d','hex');
const nativePrograms=new Set([SystemProgram.programId,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID].map(key=>key.toBase58()));
const curve=PUMP_PROGRAM_ID.toBase58(),amm=PUMP_AMM_PROGRAM_ID.toBase58();
const authority=program=>PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],program)[0];
const instructionName=(program,data)=>program.idl.instructions.find(ix=>Buffer.from(ix.discriminator).equals(data.subarray(0,8)))?.name;

// A deliberately narrow fallback for the observed migrateV2 -> createPool ->
// initBoost flow. It proves no trade instructions occur; it never infers volume
// from balances or migration liquidity. Unknown versions remain unresolved.
export function migrationOnlyProof(transaction,mint) {
  try {
    if(transaction?.meta?.err!==null) return false;
    const message=transaction.transaction.message;
    const keys=message.getAccountKeys({accountKeysFromLookups:transaction.meta.loadedAddresses});
    const top=message.compiledInstructions;
    const groups=transaction.meta.innerInstructions;
    if(!Array.isArray(top)||top.length<1||top.length>8||!Array.isArray(groups)||groups.length!==1) return false;
    const migrationIndex=top.length-1;
    if(groups[0].index!==migrationIndex) return false;
    for(const ix of top.slice(0,-1)) if(!keys.get(ix.programIdIndex)?.equals(ComputeBudgetProgram.programId)) return false;
    const root=top[migrationIndex];
    if(!keys.get(root.programIdIndex)?.equals(PUMP_PROGRAM_ID)) return false;
    if(root.data.length!==8||instructionName(PUMP_SDK.offlinePumpProgram,Buffer.from(root.data))!=='migrateV2') return false;
    const canonicalPool=canonicalPumpPoolPda(mint,NATIVE_MINT);
    const expected=['createPool','createPoolEvent','initBoost','initBoostEvent','completePumpAmmMigrationEvent'];
    const frames=[{program:curve,name:'migrateV2'}];let matched=0;
    const inner=groups[0].instructions;
    if(!Array.isArray(inner)||!inner.length) return false;
    for(let index=0;index<inner.length;index++) {
      const ix=inner[index],depth=ix.stackHeight;
      if(!Number.isInteger(depth)||depth<2||depth>frames.length+1) return false;
      frames.length=depth-1;
      const parent=frames.at(-1),program=keys.get(ix.programIdIndex)?.toBase58();
      if(!program||!Array.isArray(ix.accounts)||ix.accounts.some(i=>!Number.isInteger(i)||!keys.get(i)))return false;
      if(nativePrograms.has(program)){frames.push({program});continue;}
      if(program!==curve&&program!==amm)return false;
      const sdkProgram=program===curve?PUMP_SDK.offlinePumpProgram:PUMP_SDK.offlinePumpAmmProgram;
      const coder=sdkProgram.coder;
      const data=Buffer.from(bs58.decode(ix.data));
      let name;
      if(data.subarray(0,8).equals(eventTag)) {
        const eventName=sdkProgram.idl.events.find(event=>Buffer.from(event.discriminator).equals(data.subarray(8,16)))?.name;
        const event=eventName==='createPoolEvent'?{name:eventName,data:PUMP_SDK.decodeCreatePoolEventAmm(data.subarray(16))}:coder.events.decode(data.subarray(8).toString('base64'));name=event?.name;
        if(parent.program!==program||ix.accounts.length!==1||!keys.get(ix.accounts[0]).equals(authority(new PublicKey(program))))return false;
        const info=event?.data;
        if(!info?.pool?.equals(canonicalPool)||!(info.mint||info.baseMint)?.equals(mint)) return false;
        if(name==='createPoolEvent'&&(!info.quoteMint.equals(NATIVE_MINT)||parent.name!=='createPool'))return false;
        if(name==='initBoostEvent'&&parent.name!=='initBoost')return false;
        if(name==='completePumpAmmMigrationEvent'&&(program!==curve||parent.name!=='migrateV2'||index!==inner.length-1))return false;
      }else{
        name=instructionName(sdkProgram,data);
        if(program!==amm||parent.program!==curve||parent.name!=='migrateV2'||depth!==2)return false;
      }
      if(name!==expected[matched++])return false;
      frames.push({program,name});
    }
    return matched===expected.length;
  }catch{return false;}
}
