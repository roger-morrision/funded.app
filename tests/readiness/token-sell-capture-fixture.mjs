import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PublicKey,Keypair,TransactionInstruction} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token';
import {PUMP_AMM_SDK} from '@pump-fun/pump-swap-sdk';

// Public captured market/SDK bytes only. All operator/signature identities here
// are deterministic synthetic inputs; no RPC, wallet or signature is produced.
const raw=readFileSync(process.env.FUNDED_OFFLINE_USDC_SELL_CAPTURE||'missing-required-public-sell-capture');
assert.equal(createHash('sha256').update(raw).digest('hex'),'e0a2d89f34bcf94421c225f2d5fe2ae2ab27c2c9fa4b162396a3eb38805e6aa3');
export const capture=JSON.parse(raw),key=n=>new PublicKey(new Uint8Array(32).fill(n));
export const account=address=>{const a=capture.accounts.find(a=>a.address===String(address));assert(a);return {...a,owner:new PublicKey(a.owner),data:Buffer.from(a.dataHex,'hex')};};
const global=PUMP_AMM_SDK.decodeGlobalConfig(account(capture.sell.keys[2].pubkey));
export function sellBuilderFixture(category=5){
  const program=new PublicKey(capture.routerProgram),mint=new PublicKey(capture.sourceMint);
  const vault=PublicKey.findProgramAddressSync([Buffer.from('mint-fee-vault-v3'),mint.toBuffer(),Buffer.from([category])],program)[0];
  const swap=new TransactionInstruction({programId:new PublicKey(capture.sell.programId),data:Buffer.from(capture.sell.dataHex,'hex'),
    keys:capture.sell.keys.map(meta=>({...meta,pubkey:new PublicKey(meta.pubkey)}))});
  for(const [index,pubkey]of [[1,vault],[5,getAssociatedTokenAddressSync(new PublicKey(capture.mint),vault,true,TOKEN_PROGRAM_ID)],
    [6,getAssociatedTokenAddressSync(NATIVE_MINT,vault,true,TOKEN_PROGRAM_ID)]])swap.keys[index].pubkey=pubkey;
  return {programId:program,mint,authority:Keypair.fromSeed(new Uint8Array(32).fill(33)).publicKey,
    priceSigner:Keypair.fromSeed(new Uint8Array(32).fill(34)).publicKey,category,conversionId:Buffer.alloc(32,category),
    amountIn:capture.exactBaseIn,minSolOut:capture.minQuoteOut,pumpSellInstruction:swap,poolAccount:account(capture.market),
    protocolRecipients:global.protocolFeeRecipients,buybackRecipients:global.buybackFeeRecipients};
}
