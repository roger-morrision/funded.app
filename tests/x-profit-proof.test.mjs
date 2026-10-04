import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import BN from 'bn.js';
import nacl from 'tweetnacl';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { PUMP_SDK, PUMP_PROGRAM_ID, bondingCurvePda } from '@pump-fun/pump-sdk';
import { createXProfitVerifier, validateXProfitConsent, verifyDirectPumpEconomics, xProfitConsentStatement } from '../server/x-profit-proof.mjs';
import { buildXPost } from '../server/x-post-content.mjs';

const signer = Keypair.generate(), wallet = signer.publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58();
const tokenAccount = Keypair.generate().publicKey, appRecipient = Keypair.generate().publicKey.toBase58();
const buySignature = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
const sellSignature = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => i + 2));
const NOW = Date.parse('2026-10-04T10:00:00.000Z');
const config = { publicOrigin: 'https://funded.vip', xAccount: 'johntrand83', now: NOW, appFeeRecipient: appRecipient };
const fields = PUMP_SDK.offlinePumpProgram.idl.types.find(row => row.name === 'tradeEvent').type.fields;
function encodedEvent(side, changes = {}) {
  const event = Object.fromEntries(fields.map(field => [field.name, field.type === 'pubkey' ? PublicKey.default
    : field.type === 'bool' ? false : field.type === 'string' ? '' : typeof field.type === 'object' ? [] : new BN(0)]));
  Object.assign(event, { mint: new PublicKey(mint), user: signer.publicKey, solAmount: new BN(side === 'buy' ? '2000000000' : '4000000000'),
    tokenAmount: new BN(100), isBuy: side === 'buy', fee: new BN(1_000_000), creatorFee: new BN(500_000), ...changes });
  return Buffer.concat([Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]), PUMP_SDK.offlinePumpProgram.coder.types.encode('tradeEvent', event)]).toString('base64');
}
function transaction(side, { event = {}, extraDebit = 0 } = {}) {
  const gross = side === 'buy' ? 2_000_000_000 : 4_000_000_000, fees = 1_000_000 + 500_000 + 5_000 + 1_000_000;
  const curve = bondingCurvePda(new PublicKey(mint));
  const token = amount => [{ accountIndex: 1, mint, owner: wallet, uiTokenAmount: { amount: String(amount), decimals: 6 } }];
  return { slot: side === 'buy' ? 100 : 101, blockTime: Math.floor(NOW / 1000) - (side === 'buy' ? 2 : 1),
    transaction: { signatures: [side === 'buy' ? buySignature : sellSignature], message: {
      accountKeys: [signer.publicKey, tokenAccount, new PublicKey(mint), curve, new PublicKey(appRecipient)].map((pubkey, index) => ({ pubkey, signer: index === 0, writable: true })),
      instructions: [
        { programId: PUMP_PROGRAM_ID, accounts: [signer.publicKey, new PublicKey(mint), curve], data: bs58.encode(createHash('sha256').update(`global:${side}_v2`).digest().subarray(0, 8)) },
        { programId: SystemProgram.programId, parsed: { type: 'transfer', info: { source: wallet, destination: appRecipient, lamports: 1_000_000 } } },
      ],
    } }, meta: { err: null, fee: 5_000, preBalances: [20_000_000_000, 2_000_000, 1_000_000, 10_000_000_000, 1_000_000],
      postBalances: [20_000_000_000 + (side === 'buy' ? -gross : gross) - fees - extraDebit, 2_000_000, 1_000_000, 10_000_000_000, 2_000_000],
      preTokenBalances: token(side === 'buy' ? 0 : 100), postTokenBalances: token(side === 'buy' ? 100 : 0),
      logMessages: [`Program ${PUMP_PROGRAM_ID} invoke [1]`, `Program data: ${encodedEvent(side, event)}`, `Program ${PUMP_PROGRAM_ID} success`],
    } };
}
function consent(changes = {}, signingKey = signer) {
  const value = { version: 1, purpose: 'publish-closed-trade-on-x', cluster: 'devnet', origin: config.publicOrigin, account: config.xAccount,
    wallet, mint, buySignature, sellSignature, issuedAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 299_000).toISOString(),
    challengeId: 'a'.repeat(43), ...changes };
  value.signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(xProfitConsentStatement(value)), signingKey.secretKey));
  return value;
}
function row(changes = {}) { return { wallet, mint, buySignature, sellSignature, cluster: 'devnet', publicConsent: true, consentVerified: true, consentedAt: new Date(NOW).toISOString(), consent: consent(), ...changes }; }
function rpc(buy = transaction('buy'), sell = transaction('sell'), history = [sellSignature, buySignature]) {
  return { getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    getParsedTransaction: async (signature, options) => { assert.equal(options.commitment, 'finalized'); return signature === buySignature ? buy : sell; },
    getSignaturesForAddress: async (address, _options, commitment) => { assert.equal(address.toBase58(), tokenAccount.toBase58()); assert.equal(commitment, 'finalized'); return history.map(signature => ({ signature })); },
  };
}

test('purpose/account/origin-bound wallet sharing signature is verified independently', () => {
  const signed = consent();
  assert.equal(validateXProfitConsent(signed, config), true);
  assert.match(xProfitConsentStatement(signed), /one factual public X summary/);
  for (const change of [{ account: 'another_user' }, { origin: 'https://evil.example' }, { wallet: Keypair.generate().publicKey.toBase58() },
    { buySignature: sellSignature }, { challengeId: 'b'.repeat(43) }, { signature: bs58.encode(new Uint8Array(64)) }]) {
    assert.throws(() => validateXProfitConsent({ ...signed, ...change }, config));
  }
  assert.throws(() => validateXProfitConsent(consent({}, Keypair.generate()), config), /signature/);
  assert.throws(() => validateXProfitConsent(signed, { ...config, now: NOW + 600_000 }), /expired/);
  assert.throws(() => xProfitConsentStatement({ ...signed, expiresAt: new Date(NOW + 3_600_000).toISOString() }), /ten minutes/);
});

test('direct Pump events reconcile gross amounts and protocol, creator, app and network fees exactly', () => {
  const proof = verifyDirectPumpEconomics(transaction('buy'), { wallet, mint, side: 'buy', signature: buySignature, appFeeRecipient: appRecipient });
  assert.equal(proof.grossLamports, 2_000_000_000n);
  assert.equal(proof.feesLamports, 2_505_000n);
  assert.equal(proof.walletDeltaLamports, -2_002_505_000n);
});

test('authenticated closed direct-Pump position produces exact realized-profit formatter input', async () => {
  const verify = createXProfitVerifier({ ...config, connection: rpc() });
  const proof = await verify(row(), { state: { launches: { [mint]: { name: 'Verified token' } } } });
  assert.equal(proof.buyCostLamports, '2000000000');
  assert.equal(proof.sellProceedsLamports, '4000000000');
  assert.equal(proof.feesLamports, '5010000');
  assert.equal(proof.proofs.length, 2);
  const post = buildXPost('trade_profit', proof, { cluster: 'devnet' });
  assert.match(post.text, /Realized net profit: 1\.99499 SOL after fees/);
  assert(post.byteLength <= 280);
});

test('ATA rent, unrelated transfers, unsupported routes and complex fee models are rejected', () => {
  const options = { wallet, mint, side: 'buy', signature: buySignature, appFeeRecipient: appRecipient };
  assert.throws(() => verifyDirectPumpEconomics(transaction('buy', { extraDebit: 2_039_280 }), options), /Rent/);
  const unrelated = transaction('buy'); unrelated.transaction.message.instructions[1].parsed.info.destination = Keypair.generate().publicKey.toBase58();
  assert.throws(() => verifyDirectPumpEconomics(unrelated, options), /Unrelated/);
  const otherRoute = transaction('buy'); otherRoute.transaction.message.instructions.push({ programId: Keypair.generate().publicKey, data: '' });
  assert.throws(() => verifyDirectPumpEconomics(otherRoute, options), /Only direct/);
  for (const event of [{ mayhemMode: true }, { cashback: new BN(1) }, { buybackFee: new BN(1) }, { holderRewards: new BN(1) }, { quoteAmount: new BN(1) }]) {
    assert.throws(() => verifyDirectPumpEconomics(transaction('buy', { event }), options));
  }
  const wrongSide = transaction('buy'); wrongSide.transaction.message.instructions[0].data = bs58.encode(createHash('sha256').update('global:sell_v2').digest().subarray(0, 8));
  assert.throws(() => verifyDirectPumpEconomics(wrongSide, options), /instruction/);
});

test('trade events must be emitted by the genuine Pump invocation and match the trade identity', () => {
  const options = { wallet, mint, side: 'buy', signature: buySignature, appFeeRecipient: appRecipient };
  const spoofed = transaction('buy'); spoofed.meta.logMessages = [`Program data: ${encodedEvent('buy')}`];
  assert.throws(() => verifyDirectPumpEconomics(spoofed, options), /authentic/);
  const nested = transaction('buy'), otherProgram = Keypair.generate().publicKey;
  nested.meta.logMessages = [`Program ${PUMP_PROGRAM_ID} invoke [1]`, `Program ${otherProgram} invoke [2]`, `Program data: ${encodedEvent('buy')}`, `Program ${otherProgram} success`, `Program ${PUMP_PROGRAM_ID} success`];
  assert.throws(() => verifyDirectPumpEconomics(nested, options), /authentic/);
  assert.throws(() => verifyDirectPumpEconomics(transaction('buy', { event: { user: Keypair.generate().publicKey } }), options), /wallet, mint and side/);
  const duplicated = transaction('buy'); duplicated.meta.logMessages.splice(2, 0, `Program data: ${encodedEvent('buy')}`);
  assert.throws(() => verifyDirectPumpEconomics(duplicated, options), /One complete/);
});

test('complete token-account history, zero ending position and event amounts are mandatory', async () => {
  await assert.rejects(createXProfitVerifier({ ...config, connection: rpc(undefined, undefined, [sellSignature, 'intervening', buySignature]) })(row()), /Intervening/);
  const sell = transaction('sell'); sell.meta.postTokenBalances[0].uiTokenAmount.amount = '1';
  await assert.rejects(createXProfitVerifier({ ...config, connection: rpc(undefined, sell) })(row()), /close one exact/);
  await assert.rejects(createXProfitVerifier({ ...config, connection: rpc(transaction('buy', { event: { tokenAmount: new BN(99) } })) })(row()), /complete closed token/);
  const changed = transaction('buy'); changed.meta.postTokenBalances.push({ owner: wallet, mint: appRecipient, accountIndex: 4, uiTokenAmount: { amount: '1' } });
  assert.throws(() => verifyDirectPumpEconomics(changed, { wallet, mint, side: 'buy', signature: buySignature, appFeeRecipient: appRecipient }), /Another token/);
});

test('collector verifies immutable accepted consent while respecting network and identity boundaries', async () => {
  const verify = createXProfitVerifier({ ...config, now: NOW + 3_600_000, connection: rpc() });
  assert.equal((await verify(row())).publicConsent, true); // Grant is for one exact pair, not a recurring authorization.
  await assert.rejects(verify(row({ consentedAt: new Date(NOW + 600_000).toISOString() })), /expired/);
  await assert.rejects(verify(row({ mint: appRecipient })), /identity/);
  await assert.rejects(verify(row({ consentVerified: false })), /authenticated/);
  await assert.rejects(createXProfitVerifier({ ...config, connection: { ...rpc(), getGenesisHash: async () => 'mainnet' } })(row()), /Devnet/);
});
