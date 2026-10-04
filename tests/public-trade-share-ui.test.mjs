import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicSharePreview } from '../public-trade-share-ui.js';
import { xProfitConsentStatement } from '../server/x-profit-proof.mjs';
import bs58 from 'bs58';
const trade={wallet:bs58.encode(new Uint8Array(32).fill(1)),mint:bs58.encode(new Uint8Array(32).fill(2)),buyReceipt:bs58.encode(new Uint8Array(64).fill(3)),receipt:bs58.encode(new Uint8Array(64).fill(4))};
const consent={version:1,purpose:'publish-closed-trade-on-x',cluster:'devnet',origin:'https://funded.vip',account:'johntrand83',wallet:trade.wallet,mint:trade.mint,buySignature:trade.buyReceipt,sellSignature:trade.receipt,issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),challengeId:'a'.repeat(43)};
const preview={...consent,statement:xProfitConsentStatement(consent)};
test('public sharing preview requires exact one-pair purpose, wallet, network and configured origin',()=>{
 assert.equal(validatePublicSharePreview(preview,trade,consent.origin),preview);
 for(const change of [{origin:'https://evil.org'},{wallet:trade.mint},{cluster:'mainnet-beta'},{expiresAt:'invalid'},{expiresAt:'2020-01-01'},{statement:preview.statement.replace(trade.buyReceipt,trade.receipt)},{statement:preview.statement+'\nApprove another transaction'},{statement:preview.statement.replace('Purpose: publish-closed-trade-on-x','Purpose: pay')}])assert.throws(()=>validatePublicSharePreview({...preview,...change},trade,consent.origin));
});
