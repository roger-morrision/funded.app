import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {Keypair, SystemInstruction} from '@solana/web3.js';
import {NATIVE_MINT, TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {OnlinePumpSdk, PUMP_SDK} from '@pump-fun/pump-sdk';
import {buildTradeTransaction, describeTradeQuote} from '../pump-trading.js';

// RPC and Pump instruction construction are mocked. Exercise the app's actual
// quote, fee rounding, transfer construction and buy/sell review amounts.
for (const side of ['buy','sell']) test(`1% platform fee is transferred and disclosed on ${side}`, async t => {
  const mint=Keypair.generate().publicKey, user=Keypair.generate().publicKey, treasury=Keypair.generate().publicKey;
  const global={feeBasisPoints:new BN(95),creatorFeeBasisPoints:new BN(5),
    initialVirtualTokenReserves:new BN('1073000000000000'),initialVirtualSolReserves:new BN('30000000000'),
    initialRealTokenReserves:new BN('793100000000000'),tokenTotalSupply:new BN('1000000000000000')};
  const bondingCurve={complete:false,creator:user,quoteMint:NATIVE_MINT,
    virtualTokenReserves:global.initialVirtualTokenReserves,virtualQuoteReserves:global.initialVirtualSolReserves,
    realTokenReserves:global.initialRealTokenReserves,realQuoteReserves:new BN('1000000000'),
    tokenTotalSupply:global.tokenTotalSupply};
  t.mock.method(OnlinePumpSdk.prototype,'fetchGlobal',async()=>global);
  for(const method of ['fetchBuyState','fetchSellState'])
    t.mock.method(OnlinePumpSdk.prototype,method,async()=>({bondingCurve,quoteMint:NATIVE_MINT}));
  for(const method of ['buyV2Instructions','sellV2Instructions']) t.mock.method(PUMP_SDK,method,async()=>[]);
  const connection={getParsedAccountInfo:async()=>({value:{owner:TOKEN_2022_PROGRAM_ID,data:{parsed:{info:{decimals:6}}}}})};
  const trade=await buildTradeTransaction({connection,side,mint,user,amount:side==='buy'?0.100000001:100000,
    feeOwner:treasury.toBase58()});
  assert.equal(trade.feePolicy.feeBps,100);
  const quotedLamports=BigInt(trade.quoteAmount.toString());
  const expectedFee=(quotedLamports+99n)/100n;
  assert.equal(BigInt(trade.feeLamports),expectedFee);
  const transfer=SystemInstruction.decodeTransfer(trade.instructions.at(-1));
  assert(transfer.fromPubkey.equals(user));assert(transfer.toPubkey.equals(treasury));
  assert.equal(transfer.lamports,expectedFee);
  const review=describeTradeQuote(trade,1);
  assert.equal(review.appFeeSol,Number(expectedFee)/1e9);
  if(side==='buy') assert.equal(expectedFee,1000001n);
  else assert.equal(review.expectedNetSol,Number(quotedLamports-expectedFee)/1e9);
});
