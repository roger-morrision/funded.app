// Read-only complement to the ephemeral acceptance flow. RPC config is stdin-only.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Connection,PublicKey} from '@solana/web3.js';
import {createInterface} from 'node:readline';
import {getInitialBuyQuote} from '../launch-flow.js';
import {assertDevnet} from './devnet-acceptance.mjs';
import {createAcceptanceRpcFetch} from './devnet-acceptance-rpc.mjs';
import {verifyMintPolicyV3Account} from '../mint-router-v3.js';
import {getAccount,getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
const lines=createInterface({input:process.stdin});
for await(const line of lines){
 const report={scope:'read-only-devnet',status:'blocked',checks:[]};let output;
 try{
  const config=JSON.parse(line);output=config.output;
  const connection=new Connection(config.rpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:createAcceptanceRpcFetch()});
  assertDevnet(await connection.getGenesisHash());
  const evidence=JSON.parse(await readFile(config.evidence,'utf8'));
  assert.equal(evidence.status,'passed');assert.equal(evidence.network,'devnet');
  const base={name:'Cap probe',symbol:'CAP',supply:1_000_000_000,decimals:6,reserveTokens:30_000_000};
  const quote=await getInitialBuyQuote({connection,input:{...base,initialBuyPercent:20}});
  assert.equal(quote.amountBaseUnits,200_000_000_000_000n);
  await assert.rejects(getInitialBuyQuote({connection,input:{...base,initialBuyPercent:20.000001}}),/between 0% and 20%/);
  report.checks.push({name:'creator-buy-cap-live-quote',status:'passed',capPercent:20,tokenUnits:quote.amountBaseUnits.toString(),solLamports:quote.solAmountLamports.toString(),aboveCapRejected:true,transactionSent:false});
  const launch=evidence.checks.find(row=>row.name==='v3-launch'),launchConfig=evidence.checks.find(row=>row.name==='v3-launch-config');
  const policy=await verifyMintPolicyV3Account({connection,programId:launchConfig.programId,mint:launch.mint,
   creator:evidence.wallets.payer,initialAuthority:launchConfig.initialAuthority,split:launchConfig.split});
  assert.equal(policy.verified,true);assert.equal(policy.protectedPolicy,true);
  report.checks.push({name:'protected-mint-policy',status:'passed',mint:launch.mint,protectedPolicy:true});
  const reserveAddress=getAssociatedTokenAddressSync(new PublicKey(launch.mint),new PublicKey(launch.reserveVault),true,TOKEN_2022_PROGRAM_ID);
  const reserve=await getAccount(connection,reserveAddress,'finalized',TOKEN_2022_PROGRAM_ID);
  assert(reserve.owner.equals(new PublicKey(launch.reserveVault)));assert.equal(reserve.delegate,null);assert.equal(reserve.closeAuthority,null);
  assert(reserve.mint.equals(new PublicKey(launch.mint)));assert.equal(reserve.amount,30_000_000_000_000n);
  report.checks.push({name:'community-reserve-custody',status:'passed',mint:launch.mint,vault:launch.reserveVault,tokenAccount:reserveAddress.toBase58(),tokenUnits:reserve.amount.toString()});
  for(const side of ['buy','sell']){
   const receipt=evidence.transactions.find(row=>row.name===side),expected=evidence.checks.find(row=>row.name===side+'-fee-delta').lamports;
   const tx=await connection.getParsedTransaction(receipt.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
   assert.equal(tx?.meta?.err,null);const keys=tx.transaction.message.accountKeys.map(row=>row.pubkey.toBase58());
   const index=keys.indexOf(evidence.wallets.feeRecipient);assert(index>=0);
   assert.equal(tx.meta.postBalances[index]-tx.meta.preBalances[index],expected);
   const payments=tx.transaction.message.instructions.filter(ix=>ix.program==='system'&&ix.parsed?.type==='transfer'
    &&ix.parsed.info.source===evidence.wallets.payer&&ix.parsed.info.destination===evidence.wallets.feeRecipient);
   assert.equal(payments.length,1);assert.equal(payments[0].parsed.info.lamports,expected);
   report.checks.push({name:side+'-finalized-fee-receipt',status:'passed',signature:receipt.signature,lamports:expected});
  }
  report.status='passed';
 }catch{report.reason='A Devnet read or invariant check failed; this read-only probe never signs or submits transactions.';}
 report.checkedAt=new Date().toISOString();if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));process.exitCode=report.status==='passed'?0:2;break;
}
lines.close();
