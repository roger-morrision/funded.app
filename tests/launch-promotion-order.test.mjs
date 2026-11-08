import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, MintLayout, createBurnCheckedInstruction } from '@solana/spl-token';
import { promotionBurnStep, verifyPromotionBurnBinding } from '../launch-promotion-receipt.js';
import { confirmPromotionBurn } from '../launch-promotion-burn.js';
import { verifyLaunchPromotion } from '../server/launch-verification.mjs';
import { verifiedPromotionBadge } from '../promotion-badge.js';
import { journalRecovery } from '../launch-journal.js';

function fixture() {
  const payer=Keypair.generate(),mint=Keypair.generate(),funded=Keypair.generate().publicKey,ata=Keypair.generate().publicKey;
  const blockhash=Keypair.generate().publicKey.toBase58(),quoteId='launch_tier_1_0123456789abcdef';
  const instruction=createBurnCheckedInstruction(ata,funded,payer.publicKey,100_000_000n,6);
  const step=promotionBurnStep({payer:payer.publicKey,mint,burnInstruction:instruction,quoteId,blockhash});
  const message=step.transaction.compileMessage();
  const accountIndex=message.accountKeys.findIndex(k=>k.equals(ata));
  const balance=amount=>({accountIndex,mint:funded.toBase58(),owner:payer.publicKey.toBase58(),uiTokenAmount:{amount,decimals:6}});
  const transaction={slot:10,blockTime:100,transaction:{message},meta:{err:null,preTokenBalances:[balance('200000000')],postTokenBalances:[balance('100000000')]}};
  const data=Buffer.alloc(MintLayout.span);
  MintLayout.encode({mintAuthorityOption:0,mintAuthority:funded,supply:900_000_000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:funded},data);
  const calls=[],events=[];
  const connection={getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:100}),
    sendRawTransaction:async raw=>{calls.push('send');const signed=Transaction.from(raw);return (await import('bs58')).default.encode(signed.signature);},
    confirmTransaction:async()=>{calls.push('finalized');return {value:{err:null}};},
    getTransaction:async()=>{calls.push('receipt');return transaction;},
    getAccountInfoAndContext:async()=>({context:{slot:10},value:{data,owner:TOKEN_PROGRAM_ID,executable:false,lamports:1}})};
  const args={connection,provider:{signTransaction:async tx=>{calls.push('sign');tx.partialSign(payer);return tx;}},payer:payer.publicKey,mint,
    burnPlan:{instruction,mint:funded,tokenAccount:ata,amount:100_000_000n,amountTokens:100,decimals:6,supplyBefore:1_000_000_000n},quoteId,
    onJournal:e=>events.push(e),onStatus:()=>{},assertWalletCurrent:()=>{},beforeBroadcast:()=>{}};
  const quote={id:quoteId,tier:'pro',payer:payer.publicKey.toBase58(),fundedMint:funded.toBase58(),amountTokens:100,usd:10,createdAt:new Date(90_000).toISOString(),expiresAt:new Date(110_000).toISOString()};
  const claim={tier:'pro',amountTokens:100,fundedMint:funded.toBase58(),quoteId,receipt:{signature:'burn-signature'}};
  return {payer,mint,transaction,args,calls,events,claim,quote,funded};
}
test('burn is signed, finalized and exact balance/supply changes verified before returning',async()=>{
  const f=fixture();const receipt=await confirmPromotionBurn(f.args);
  assert.deepEqual(f.calls,['sign','send','finalized','receipt']);
  assert.equal(receipt.confirmedBeforeLaunch,true);assert.equal(receipt.atomicWithPumpLaunch,false);
  assert.equal(receipt.amountBaseUnits,'100000000');assert.equal(receipt.supplyAfter,'900000000');
  assert.ok(f.events.every(e=>e.step==='promotion-burn'));
});
test('cancelled approval sends nothing',async()=>{
  const f=fixture();f.args.provider.signTransaction=async()=>{throw Error('User rejected');};
  await assert.rejects(confirmPromotionBurn(f.args),/rejected/);assert.deepEqual(f.calls,[]);
});
test('expired quote guard stops before signing',async()=>{
  const f=fixture();f.args.beforeBroadcast=()=>{throw Error('Quote expired');};
  await assert.rejects(confirmPromotionBurn(f.args),/expired/);assert.deepEqual(f.calls,[]);
});
test('failed or uncertain confirmations never produce a verified burn',async()=>{
  for(const uncertain of [false,true]){const f=fixture();f.args.connection.confirmTransaction=async()=>{if(uncertain)throw Error('timeout');return {value:{err:'failed'}};};
    await assert.rejects(confirmPromotionBurn(f.args));assert.equal(f.calls.includes('receipt'),false);
    assert.ok(f.events.some(e=>e.state===(uncertain?'unknown':'failed')));}
});
test('wrong token delta stops creation even after finality',async()=>{
  const f=fixture();f.transaction.meta.postTokenBalances[0].uiTokenAmount.amount='199000000';
  await assert.rejects(confirmPromotionBurn(f.args),/exact token reduction/);
});
test('server independently verifies separate burn, mint binding and historical atomic receipts',async()=>{
  const f=fixture();const args={connection:f.args.connection,transaction:{slot:11},payer:f.payer.publicKey.toBase58(),signature:'creation-signature',mint:f.mint.publicKey.toBase58(),claim:f.claim,fundedMint:f.funded.toBase58(),quote:f.quote};
  const result=await verifyLaunchPromotion(args);
  assert.equal(result.receipt.confirmedBeforeLaunch,true);assert.equal(result.quoteId,f.quote.id);
  assert.equal(verifiedPromotionBadge({onchainVerified:true,signature:'creation-signature',creatorLaunchBurn:result}).tier,'pro');
  for(const change of [{mint:Keypair.generate().publicKey.toBase58()},{payer:Keypair.generate().publicKey.toBase58()},{transaction:{slot:10}},{claim:{...f.claim,quoteId:'launch_tier_2_0123456789abcdef'}},{quote:{...f.quote,expiresAt:new Date(1).toISOString()}}])
    await assert.rejects(verifyLaunchPromotion({...args,...change}));
  const old=await verifyLaunchPromotion({...args,signature:'burn-signature',transaction:f.transaction});
  assert.equal(old.receipt.atomicWithPumpLaunch,true);
});
test('recovery does not claim a coin exists when only the burn finalized',()=>{
  assert.match(journalRecovery({state:'cancelled',events:[{state:'confirmed',step:'promotion-burn'}]}),/coin creation is not confirmed/);
});
test('a burn cannot authorize multiple launch mint signers',()=>{
  const f=fixture();f.transaction.transaction.message.header.numRequiredSignatures=3;
  assert.throws(()=>verifyPromotionBurnBinding({transaction:f.transaction,payer:f.payer.publicKey.toBase58(),mint:f.mint.publicKey.toBase58(),quoteId:f.quote.id}),/only by its payer and launch mint/);
});
