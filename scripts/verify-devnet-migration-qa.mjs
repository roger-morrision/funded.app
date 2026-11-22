// Read-only verification of the disposable Devnet curve completion and migration.
// The buyer key existed only in memory during execution and is not used here.
import assert from 'node:assert/strict';
import {Connection,PublicKey} from '@solana/web3.js';
import {bondingCurvePda,PUMP_SDK} from '@pump-fun/pump-sdk';
import {canonicalPumpPoolPda,OnlinePumpAmmSdk,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID,unpackAccount} from '@solana/spl-token';

const connection=new Connection('https://api.devnet.solana.com',{commitment:'finalized',disableRetryOnRateLimit:true});
const mint=new PublicKey('Cp83URacwBZpMvVw2fSPtGy3RzWjD35AzF2KcKaYyENp');
const buyer=new PublicKey('BqCQc4oZEWKfkdkX3XrBTupA3fCqqmWWWcDeBRZPGbZi');
const authority=new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const router=new PublicKey('9E7wuzUbNLpauYH5BR6qPmg6mjb5qsZJW96zjLJELfCf');
const signatures={
  funding:'KRpq7db2qSGWP9Y327AHQPyAhxo9XAAoTXnfZH1bZahrN3Kiyqtpq5tXzTMSscAVTPgajwxnQ1xjLQHJ5df9MaT',
  buy:'2ntVcCi39TDAoFV8kt1zkW2GvHLedkARvwxrN9DrJh3VqXYd8fpgRaPm7mN87TgbfBb7znvjZFynzZhchFBSZ5Ex',
  migration:'5Jsyr3M4GWhTRioAeFi7N7bTyEXotfQwsYpQwxFRQZ1MFzdcax48eNq6393tMPEPr8eBstVnVJn8AKgJrauseduE',
  custody:'634822pgyCvioKiKP8gafEwJABiSBqcEnHxKubnjVEj8MDQCHNc4Acf8exTwZ9FvEE27UkJNAyipRrCwk8NmA4EV',
  refund:'2cwTaNjqpsWbRbXiTbYdZsm5dFsR1NeVrKhoeVUFCrgvoUxpYzFgyE7sM8TGunwiD39F82UuH2kUuKGWWtswhh6m'
};
assert.equal(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const statuses=(await connection.getSignatureStatuses(Object.values(signatures),{searchTransactionHistory:true})).value;
for(const status of statuses)assert(status?.confirmationStatus==='finalized'&&status.err===null);
const transactions={};
for(const [name,signature] of Object.entries(signatures)){
  transactions[name]=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  assert(transactions[name]?.meta?.err===null,`${name} lacks a finalized successful transaction`);
}
const keys=transaction=>transaction.transaction.message.staticAccountKeys||transaction.transaction.message.accountKeys;
const balance=(transaction,address,kind)=>{
  const index=keys(transaction).findIndex(key=>key.equals(address));
  assert(index>=0,`missing ${address} in transaction`);
  return transaction.meta[kind==='before'?'preBalances':'postBalances'][index];
};
const token=(transaction,owner,kind)=>transaction.meta[kind==='before'?'preTokenBalances':'postTokenBalances']
  .find(row=>row.owner===owner.toBase58()&&row.mint===mint.toBase58())?.uiTokenAmount.amount;
const funded=transactions.funding,bought=transactions.buy,migrated=transactions.migration,
  custody=transactions.custody,refunded=transactions.refund;
assert.equal(balance(funded,buyer,'after')-balance(funded,buyer,'before'),1_200_000_000);
assert.equal(balance(funded,authority,'before')-balance(funded,authority,'after'),1_200_000_000+funded.meta.fee);
assert.equal(balance(bought,buyer,'before'),1_200_000_000);
assert.equal(token(bought,buyer,'after'),'792100000000000');
assert.equal(token(bought,bondingCurvePda(mint),'before'),'999000000000000');
assert.equal(token(bought,bondingCurvePda(mint),'after'),'206900000000000');
assert(migrated.slot>bought.slot);
assert.equal(token(custody,buyer,'before'),'792100000000000');
assert.equal(token(custody,buyer,'after'),undefined);
assert.equal(BigInt(token(custody,authority,'after'))-BigInt(token(custody,authority,'before')),792100000000000n);
assert.equal(balance(refunded,buyer,'after'),0);
assert.equal(balance(refunded,authority,'after')-balance(refunded,authority,'before'),
  balance(refunded,buyer,'before')-refunded.meta.fee);
const pool=canonicalPumpPoolPda(mint),buyerAta=getAssociatedTokenAddressSync(mint,buyer,false,TOKEN_2022_PROGRAM_ID),
  authorityAta=getAssociatedTokenAddressSync(mint,authority,false,TOKEN_2022_PROGRAM_ID);
const approval=PublicKey.findProgramAddressSync([Buffer.from('snapshot-approval-v1'),authority.toBuffer(),mint.toBuffer()],router)[0];
const drop=PublicKey.findProgramAddressSync([Buffer.from('community-drop-v1'),authority.toBuffer(),mint.toBuffer()],router)[0];
const rewardVault=PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'),authority.toBuffer(),mint.toBuffer()],router)[0];
const rewardAta=getAssociatedTokenAddressSync(mint,rewardVault,true,TOKEN_2022_PROGRAM_ID);
const addresses=[bondingCurvePda(mint),pool,buyer,buyerAta,authorityAta,approval,drop,rewardAta];
const accounts=await connection.getMultipleAccountsInfoAndContext(addresses,{commitment:'finalized'});
const [curveAccount,poolAccount,buyerAccount,buyerTokenAccount,authorityTokenAccount,approvalAccount,dropAccount,rewardTokenAccount]=accounts.value;
assert(PUMP_SDK.decodeBondingCurve(curveAccount).complete);
assert.equal(PUMP_SDK.decodeBondingCurve(curveAccount).realTokenReserves.toString(),'0');
assert(poolAccount?.owner.equals(PUMP_AMM_PROGRAM_ID));
assert.equal(buyerAccount?.lamports||0,0);
assert.equal(buyerTokenAccount,null);
const poolState=await new OnlinePumpAmmSdk(connection).swapSolanaState(pool,authority);
assert(poolState.pool.baseMint.equals(mint));
assert(BigInt(poolState.poolBaseAmount.toString())>0n&&BigInt(poolState.poolQuoteAmount.toString())>0n);
console.log(JSON.stringify({schemaVersion:1,scope:'finalized Devnet read-only verification',checkedAt:new Date().toISOString(),
  genesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',checkedSlot:accounts.context.slot,
  router:router.toBase58(),mint:mint.toBase58(),buyer:buyer.toBase58(),authority:authority.toBase58(),
  signatures:Object.fromEntries(Object.entries(signatures).map(([name,signature])=>[name,{signature,slot:transactions[name].slot,
    feeLamports:transactions[name].meta.fee,finalized:true,err:null}])),
  buy:{quotedLamports:'860395917',buyerSolDebitLamports:balance(bought,buyer,'before')-balance(bought,buyer,'after'),
    tokensBoughtBaseUnits:token(bought,buyer,'after'),curveComplete:true,curveRemainingTokenBaseUnits:'0'},
  migration:{pool:pool.toBase58(),owner:poolAccount.owner.toBase58(),baseReserve:poolState.poolBaseAmount.toString(),
    quoteReserve:poolState.poolQuoteAmount.toString(),blockTime:migrated.blockTime},
  custody:{buyerTokenAccountClosed:true,authorityTokenBalanceBaseUnits:unpackAccount(authorityAta,authorityTokenAccount,TOKEN_2022_PROGRAM_ID).amount.toString(),
    buyerSolAfterRefund:buyerAccount?.lamports||0},
  communityClaim:{snapshotApproval:approval.toBase58(),snapshotApprovalExists:!!approvalAccount,
    drop:drop.toBase58(),dropExists:!!dropAccount,rewardVault:rewardVault.toBase58(),
    rewardVaultTokenBalanceBaseUnits:rewardTokenAccount?unpackAccount(rewardAta,rewardTokenAccount,TOKEN_2022_PROGRAM_ID).amount.toString():null,
    status:'blocked: isolated router has no approved holder snapshot or funded community reserve; live signer allowlist is pinned to the public app router'},
  limits:['The buy was submitted once; blockheight confirmation timed out, then the exact signature and state deltas reconciled at finalized commitment.',
    'The automatic Pump migration was signed by its own keeper, not by this QA wallet.',
    'No community airdrop approval, drop or claim transaction was submitted.']},null,2));
