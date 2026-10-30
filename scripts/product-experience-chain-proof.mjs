import { PublicKey } from '@solana/web3.js';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import { DEVNET_GENESIS_HASH,readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';
import { loadFinalizedV3Buyback } from '../server/v3-buyback-proof.mjs';

// Independently recheck one historical transaction. Never submit or sign.
export async function verifyCandidateBurn(connection,row,launch){
  if(await connection.getGenesisHash()!==DEVNET_GENESIS_HASH)throw new Error('Receipt RPC must be Solana Devnet.');
  const program=new PublicKey(row.programId),programData=await readProgramDataEvidence(connection,program);
  if(!/^[a-f0-9]{64}$/i.test(row.approvedHash||'')||programData.sha256!==row.approvedHash.toLowerCase())throw new Error('Current program bytecode differs from the recorded approved hash.');
  const tx=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!tx||tx.meta?.err!==null)throw new Error('Finalized receipt transaction unavailable.');
  const message=tx.transaction.message,keys=[...(message.accountKeys||message.staticAccountKeys||[]),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(value=>new PublicKey(value));
  const discriminator=createHash('sha256').update('global:buyback_mint_v3').digest().subarray(0,8);
  const instructions=(message.instructions||message.compiledInstructions||[]).filter(ix=>keys[ix.programIdIndex]?.equals(program));
  const ix=instructions.find(ix=>{const bytes=typeof ix.data==='string'?bs58.decode(ix.data):ix.data;return Buffer.from(bytes).subarray(0,8).equals(discriminator);});
  if(!ix)throw new Error('A matching V3 buyback instruction is unavailable.');
  const accounts=Array.from(ix.accounts||ix.accountKeyIndexes||[],index=>keys[index]);
  if(accounts.length<41)throw new Error('Buyback account evidence is incomplete.');
  const cached=new Proxy(connection,{get(target,key){if(key==='getTransaction')return async signature=>signature===row.signature?tx:target.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const proof=await loadFinalizedV3Buyback({connection:cached,signature:row.signature,programId:program,sourceMint:new PublicKey(row.mint),
    creator:new PublicKey(row.creator||launch.creatorWallet),initialAuthority:new PublicKey(row.initialAuthority||launch.pumpFeeRoute.initialAuthority),authority:accounts[0],
    baseTokenProgram:new PublicKey(row.baseTokenProgram),buybackId:Buffer.from(row.buybackId,'hex'),spendableQuoteIn:BigInt(row.spendableQuoteIn),
    minBaseAmountOut:BigInt(row.minBaseAmountOut),maxTotalDebit:BigInt(row.maxTotalDebit),split:launch.pumpFeeRoute.protocolSplit||null,
    pumpBuyInstruction:{programId:PUMP_AMM_PROGRAM_ID,data:Buffer.from([102,6,61,18,1,218,235,234]),keys:accounts.slice(16).map(pubkey=>({pubkey,isSigner:false,isWritable:false}))}});
  if(!proof?.finalized||!proof.vaultDebitVerified||!proof.burnInstructionVerified||proof.spentLamports!==row.spentLamports||proof.burnedBaseUnits!==row.burnedBaseUnits)
    throw new Error('Recorded burn does not match the independently verified debit and burn.');
  return {signature:row.signature,slot:proof.slot,spentLamports:proof.spentLamports,burnedBaseUnits:proof.burnedBaseUnits,programDataSha256:programData.sha256,evidence:'fresh-finalized-rpc-burn-and-vault-delta'};
}
